import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import IORedis from 'ioredis';
import { createApp } from '../../src/app.js';
import { createQueue } from '../../src/queue.js';
import { loadConfig } from '../../src/config.js';
import { createImportStore } from '../../src/imports/store.js';
import { importIdFor } from '../../src/imports/csv.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real HTTP/Redis/MongoDB with two worker processes: imports, retries and duplicate prevention', { timeout: 90000 }, async t => {
  const config = loadConfig();
  const testName = `jobpulse_test_${randomUUID().replaceAll('-', '')}`;
  // Preserve URI credentials/options, but isolate every test in its own database.
  const mongoUrl = new URL(config.mongodbUrl);
  mongoUrl.pathname = `/${testName}`;
  const mongodbUrl = mongoUrl.toString();
  const client = new MongoClient(mongodbUrl, { serverSelectionTimeoutMS: 3000 });
  const store = createImportStore(mongodbUrl);
  const children = [];
  const jobs = [];
  const events = [];
  let server;
  let resources;
  try {
    await client.connect();
    const probe = new IORedis(config.redisUrl, { lazyConnect: true, retryStrategy: () => null, connectTimeout: 2000 });
    probe.on('error', () => {});
    try { await probe.connect(); await probe.ping(); } finally { probe.disconnect(); }
    resources = createQueue(config.redisUrl, testName);
    await resources.queue.waitUntilReady();
    server = createApp(resources.queue, store).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const retryBytes = Buffer.from('name,email,age\nRetry,retry@example.com,20\n');
    const exhaustBytes = Buffer.from('name,email,age\nExhaust,exhaust@example.com,20\n');
    for (let i = 0; i < 2; i += 1) {
      const child = fork(new URL('../helpers/import-worker.js', import.meta.url), [], {
        env: { ...process.env, REDIS_URL: config.redisUrl, MONGODB_URL: mongodbUrl,
          JOBPULSE_TEST_QUEUE: testName, JOBPULSE_TEST_RETRY_ID: importIdFor(retryBytes),
          JOBPULSE_TEST_EXHAUST_ID: importIdFor(exhaustBytes) },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      children.push(child);
      child.on('message', message => events.push(message));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 10000);
        child.on('message', message => { if (message.event === 'ready') { clearTimeout(timer); resolve(); } });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited: ${code}`)); });
      });
    }
    async function upload(bytes) {
      const body = new FormData();
      body.append('file', new Blob([bytes], { type: 'text/csv' }), 'source.csv');
      const response = await fetch(`${base}/api/v1/imports`, { method: 'POST', body });
      assert.equal(response.status, 202, await response.clone().text());
      const receipt = await response.json();
      jobs.push(receipt.jobId);
      return receipt;
    }
    async function finished(id, expected, timeout = 30000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const job = await resources.queue.getJob(id);
        if (job && ['completed', 'failed'].includes(await job.getState())) {
          assert.equal(await job.getState(), expected);
          return job;
        }
        await delay(100);
      }
      assert.fail(`Timed out waiting for ${id}`);
    }

    await t.test('independent worker processes preserve simulation jobs', async () => {
      const simulationIds = [];
      for (let i = 0; i < 2; i += 1) {
        const id = randomUUID();
        await resources.queue.add('simulation', { mode: 'complete' }, { jobId: id });
        jobs.push(id); simulationIds.push(id);
      }
      await Promise.all(simulationIds.map(id => finished(id, 'completed')));
      const pids = new Set(events.filter(event => event.event === 'active' && simulationIds.includes(event.id)).map(event => event.pid));
      assert.equal(pids.size, 2);
    });

    await t.test('concurrent identical uploads share one import and rows; database unique index rejects duplicate inserts', async () => {
      const bytes = await readFile(new URL('../../samples/mixed.csv', import.meta.url));
      const receipts = await Promise.all([upload(bytes), upload(bytes)]);
      assert.equal(receipts[0].importId, receipts[1].importId);
      const id = receipts[0].importId;
      const job = await finished(id, 'completed');
      assert.deepEqual(job.returnvalue, { importId: id, processed: 5, accepted: 2, rejected: 3 });
      assert.equal(await client.db().collection('records').countDocuments({ importId: id }), 2);
      const row = await client.db().collection('records').findOne({ importId: id });
      delete row._id;
      await assert.rejects(client.db().collection('records').insertOne(row), error => error.code === 11000);
      const summaryResponse = await fetch(`${base}/api/v1/imports/${id}`);
      const summary = await summaryResponse.json();
      assert.equal(summary.finished, true);
      assert.equal(summary.processed, 5);
      assert.equal('source' in summary, false);
      const status = await (await fetch(`${base}${receipts[0].statusUrl}`)).json();
      assert.equal(status.state, 'completed');
      assert.equal(status.result.accepted, 2);
      await upload(bytes);
      assert.equal(await client.db().collection('records').countDocuments({ importId: id }), 2);
    });

    await t.test('transient failures retry with increasing delays and cannot duplicate committed rows', async () => {
      const receipt = await upload(retryBytes);
      const job = await finished(receipt.importId, 'completed');
      assert.equal(job.attemptsMade, 3);
      assert.equal(job.returnvalue.accepted, 1);
      const starts = events.filter(event => event.event === 'active' && event.id === receipt.importId);
      assert.equal(starts.length, 3);
      assert.ok(starts[1].at - starts[0].at >= 900, 'first retry waited for its 1-second backoff');
      assert.ok(starts[2].at - starts[1].at >= 1900, 'second retry waited for its 2-second backoff');
      assert.equal(await client.db().collection('records').countDocuments({ importId: receipt.importId }), 1);
      const summary = await store.summary(receipt.importId);
      assert.equal(summary.processed, 1);
    });

    await t.test('retry exhaustion retains failure and malformed syntax skips retries', async () => {
      const receipt = await upload(exhaustBytes);
      const exhausted = await finished(receipt.importId, 'failed');
      assert.equal(exhausted.attemptsMade, 3);
      assert.equal(await client.db().collection('records').countDocuments({ importId: receipt.importId }), 1);
      assert.equal((await store.summary(receipt.importId)).finished, false);
      const malformed = await upload(await readFile(new URL('../../samples/malformed.csv', import.meta.url)));
      const bad = await finished(malformed.importId, 'failed');
      assert.equal(bad.attemptsMade, 1);
    });

    await t.test('read endpoints report actual counts, filters, pagination and typed detail', async () => {
      const queueResponse = await fetch(`${base}/api/v1/queue`);
      assert.equal(queueResponse.status, 200);
      const snapshot = await queueResponse.json();
      assert.equal(snapshot.total, new Set(jobs).size);
      assert.equal(snapshot.counts.active, 0);
      const list = await (await fetch(`${base}/api/v1/jobs?status=completed&type=simulation&pageSize=1`)).json();
      assert.equal(list.total, 2);
      assert.equal(list.items.length, 1);
      const second = await (await fetch(`${base}/api/v1/jobs?status=completed&type=simulation&pageSize=1&page=2`)).json();
      assert.notEqual(list.items[0].jobId, second.items[0].jobId);
      const detail = await (await fetch(`${base}/api/v1/jobs/${list.items[0].jobId}`)).json();
      assert.equal(detail.type, 'simulation');
      assert.equal(detail.maxAttempts, 1);
      assert.ok(detail.createdAt > 0);
      assert.ok(detail.finishedAt >= detail.startedAt);
    });

    await t.test('205 rows persist in batches and replay concurrently without duplicates', async () => {
      const bytes = Buffer.from(`name,email,age\n${Array.from({ length: 205 }, (_, i) => `User ${i},u${i}@example.com,20`).join('\n')}\n`);
      const receipt = await upload(bytes);
      const job = await finished(receipt.importId, 'completed');
      assert.equal(job.returnvalue.processed, 205);
      const { processCsvImport } = await import('../../src/imports/processor.js');
      const replayJob = { id: receipt.importId, name: 'csv-import', data: { importId: receipt.importId }, updateProgress: async () => {} };
      await Promise.all([processCsvImport(replayJob, store), processCsvImport(replayJob, store)]);
      assert.equal(await client.db().collection('records').countDocuments({ importId: receipt.importId }), 205);
      assert.equal((await store.summary(receipt.importId)).accepted, 205);
    });
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.connected) {
        const exit = once(child, 'exit');
        child.send('close');
        await exit;
      }
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (resources) {
      for (const id of new Set(jobs)) {
        const job = await resources.queue.getJob(id);
        if (job) await job.remove();
      }
      await resources.close();
    }
    // Remove only fixtures from this run's isolated database; never drop/flush a database.
    if (jobs.length) {
      await client.db().collection('records').deleteMany({ importId: { $in: jobs } });
      await client.db().collection('imports').deleteMany({ _id: { $in: jobs } });
    }
    await store.close();
    await client.close();
  }
});
