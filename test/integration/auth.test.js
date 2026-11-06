import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createApp } from '../../src/app.js';
import { createAuthStore } from '../../src/auth/store.js';
import { createImportStore } from '../../src/imports/store.js';
import { createJobProcessor } from '../../src/processor.js';
import { createQueue } from '../../src/queue.js';
import { loadConfig } from '../../src/config.js';
import { importIdFor } from '../../src/imports/csv.js';
import { makeClient } from '../helpers/client.js';

test('real MongoDB sessions and two-user ownership isolation with real CSV workers', { timeout: 60000 }, async t => {
  const config = loadConfig();
  const namespace = `jobpulse_auth_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(config.mongodbUrl); url.pathname = `/${namespace}`;
  const client = new MongoClient(url.toString(), { serverSelectionTimeoutMS: 3000 });
  const authStore = createAuthStore(url.toString());
  const store = createImportStore(url.toString());
  const resources = createQueue(config.redisUrl, namespace);
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => {});
  let server, worker;
  const ids = [];
  const bytes = Buffer.from('name,email,age\nAda,ada@example.com,36\nInvalid,invalid,500\n');
  try {
    await client.connect(); await resources.queue.waitUntilReady();
    worker = new Worker(namespace, createJobProcessor(store), { connection, concurrency: 1 });
    worker.on('error', () => {});
    server = createApp(resources.queue, store, { authStore }).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const a = makeClient(base), b = makeClient(base);
    await a.register('alice@example.com'); await b.register('bob@example.com');
    async function upload(account) {
      const form = new FormData(); form.append('file', new Blob([bytes], { type: 'text/csv' }), 'same.csv');
      const response = await account.fetch('/api/v1/imports', { method: 'POST', body: form });
      assert.equal(response.status, 202);
      const receipt = await response.json(); ids.push(receipt.importId); return receipt.importId;
    }
    async function done(id) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await (await resources.queue.getJob(id)).getState() === 'completed') return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail('CSV did not complete');
    }
    let aliceId, bobId;
    await t.test('same CSV deduplicates within a user but produces different IDs and records across users', async () => {
      [aliceId, bobId] = await Promise.all([upload(a), upload(b)]);
      assert.notEqual(aliceId, bobId);
      assert.equal(await upload(a), aliceId);
      await Promise.all([done(aliceId), done(bobId)]);
      assert.equal(await client.db().collection('imports').countDocuments({}), 2);
      assert.equal(await client.db().collection('records').countDocuments({ ownerId: a.user.id }), 1);
      assert.equal(await client.db().collection('records').countDocuments({ ownerId: b.user.id }), 1);
      const detail = await (await a.fetch(`/api/v1/jobs/${aliceId}`)).json();
      assert.deepEqual(detail.result, { importId: aliceId, processed: 2, accepted: 1, rejected: 1 });
    });
    await t.test('foreign/anonymous users cannot access job, file summary or results; no source download exists', async () => {
      for (const path of [`/api/v1/jobs/${aliceId}`, `/api/v1/imports/${aliceId}`, `/api/v1/imports/${aliceId}/source`]) {
        assert.equal((await fetch(base + path)).status, 401);
        assert.equal((await b.fetch(path)).status, 404);
      }
      const summary = await (await a.fetch(`/api/v1/imports/${aliceId}`)).json();
      assert.equal('source' in summary, false);
      assert.equal(await store.getSource(aliceId, b.user.id), undefined);
      assert.equal((await a.fetch(`/api/v1/jobs/${bobId}`)).status, 404);
    });
    await t.test('legacy unowned jobs are not claimed by a user, counted or listed', async () => {
      const legacyId = importIdFor(bytes); ids.push(legacyId);
      await store.putSource(legacyId, bytes);
      await resources.queue.add('csv-import', { importId: legacyId }, { jobId: legacyId });
      await done(legacyId);
      for (const account of [a, b]) {
        assert.equal((await account.fetch(`/api/v1/jobs/${legacyId}`)).status, 404);
        assert.equal((await account.fetch(`/api/v1/imports/${legacyId}`)).status, 404);
        const history = await (await account.fetch('/api/v1/jobs')).json();
        assert.equal(history.total, 1);
        assert.equal(history.items[0].jobId, account === a ? aliceId : bobId);
        const metrics = await (await account.fetch('/api/v1/queue')).json();
        assert.equal(metrics.total, 1); assert.equal(metrics.counts.completed, 1);
      }
    });
    await t.test('simulation ownership is assigned server-side and summary polling is not upload-rate-limited', async () => {
      const response = await a.fetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'simulation', mode: 'complete' }) });
      assert.equal(response.status, 202);
      const { jobId } = await response.json(); ids.push(jobId);
      assert.equal((await resources.queue.getJob(jobId)).data.ownerId, a.user.id);
      assert.equal((await b.fetch(`/api/v1/jobs/${jobId}`)).status, 404);
      for (let index = 0; index < 12; index++) assert.equal((await a.fetch(`/api/v1/imports/${aliceId}`)).status, 200);
      // Simulation preserves the real ten-second handler.
      for (let index = 0; index < 150; index++) {
        if (await (await resources.queue.getJob(jobId)).getState() === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(await (await resources.queue.getJob(jobId)).getState(), 'completed');
      assert.equal((await (await a.fetch('/api/v1/queue')).json()).total, 2);
      assert.equal((await (await b.fetch('/api/v1/queue')).json()).total, 1);
    });

    await t.test('ownership overrides, forged cookies, CSRF and expired MongoDB sessions fail safely', async () => {
      assert.equal((await a.fetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'simulation', mode: 'complete', ownerId: b.user.id }) })).status, 400);
      assert.equal((await a.fetch(`/api/v1/jobs?ownerId=${b.user.id}`)).status, 400);
      const noCsrf = await fetch(base + '/api/v1/jobs', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json', 'X-JobPulse-Request': '1' }, body: JSON.stringify({ type: 'simulation', mode: 'complete' }) });
      assert.equal(noCsrf.status, 403);
      assert.equal((await fetch(base + '/api/v1/jobs', { headers: { Cookie: 'jobpulse_session=' + 't'.repeat(43) } })).status, 401);
      const sessions = client.db().collection('sessions');
      const session = await sessions.findOne({ userId: a.user.id });
      assert.equal(session._id.includes(a.cookie.split('=')[1]), false);
      await sessions.updateMany({ userId: a.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await a.fetch('/api/v1/auth/session')).status, 401);
      assert.equal((await a.fetch(`/api/v1/jobs/${aliceId}`)).status, 401);
      assert.equal((await b.fetch(`/api/v1/jobs/${bobId}`)).status, 200);
      assert.equal((await b.fetch('/api/v1/auth/logout', { method: 'POST' })).status, 204);
      assert.equal((await b.fetch('/api/v1/jobs')).status, 401);
    });
  } finally {
    if (worker) await worker.close(); connection.disconnect();
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of new Set(ids)) { const job = await resources.queue.getJob(id); if (job) await job.remove(); }
    await resources.close();
    // All collections are in this run's unique test database; never drop/flush a database.
    for (const name of ['records', 'imports', 'jobs', 'sessions', 'users']) await client.db().collection(name).deleteMany({});
    await store.close(); await authStore.close(); await client.close();
  }
});
