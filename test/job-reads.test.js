import test from 'node:test';
import assert from 'node:assert/strict';
import { testApp, authFetch as fetch, TEST_OWNER } from './helpers/auth.js';
import { publicJob } from '../src/job-reads.js';

async function withApi(jobs, run, fail = false) {
  const queue = { name: 'test-queue', isPaused: async () => false, async getJob(id) {
    if (fail) throw new Error('private secret');
    return jobs.find(job => job.id === id);
  } };
  const store = { ownedJobs: async owner => { assert.equal(owner, TEST_OWNER); return jobs.filter(job => job.catalogOwner === TEST_OWNER).map(job => ({ _id: job.id })); } };
  const server = testApp(queue, store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/v1`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const job = (id, type, timestamp, state = 'completed', owner = TEST_OWNER) => ({
  id, name: type, timestamp, data: { ownerId: owner }, catalogOwner: owner, progress: 0,
  opts: { attempts: 3 }, getState: async () => state,
});

test('queue statistics count only catalog-owned jobs and exclude legacy/foreign jobs', async () => {
  const jobs = [job('a', 'simulation', 1, 'completed'), job('b', 'csv-import', 2, 'delayed'),
    job('c', 'simulation', 3, 'prioritized'), job('foreign', 'simulation', 4, 'failed', 'another-user'),
    job('legacy', 'simulation', 5, 'completed', null)];
  await withApi(jobs, async base => {
    const response = await fetch(`${base}/queue`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.counts, { waiting: 1, active: 0, completed: 1, failed: 0, delayed: 1, waitingChildren: 0 });
    assert.equal(body.total, 3);
    assert.equal(body.source, 'retained-owned-bullmq-jobs');
  });
});

test('private history filters, searches, sorts and paginates owned snapshots', async () => {
  await withApi([job('aaa', 'csv-import', 200, 'active'), job('ccc', 'simulation', 300),
    job('bbb', 'csv-import', 100), job('foreign', 'simulation', 400, 'completed', 'other')], async base => {
    let body = await (await fetch(`${base}/jobs?pageSize=1`)).json();
    assert.equal(body.total, 3); assert.equal(body.items[0].jobId, 'ccc');
    body = await (await fetch(`${base}/jobs?page=2&pageSize=1`)).json();
    assert.equal(body.items[0].state, 'active');
    body = await (await fetch(`${base}/jobs?type=csv-import&status=completed&search=BB`)).json();
    assert.equal(body.total, 1); assert.equal(body.items[0].jobId, 'bbb');
    body = await (await fetch(`${base}/jobs?search=foreign`)).json();
    assert.deepEqual(body.items, []);
  });
});

test('private history rejects malformed queries and owner overrides', async () => {
  await withApi([], async base => {
    for (const query of ['status=made-up', 'type=shell', 'page=-1', 'page=1.1', 'pageSize=51', 'page=1&page=2', 'ownerId=other', `search=${'x'.repeat(129)}`]) {
      assert.equal((await fetch(`${base}/jobs?${query}`)).status, 400, query);
    }
  });
});

test('public job metadata preserves results, reports retries and excludes raw input/secrets', () => {
  const input = { ...job('abc', 'csv-import', 100), processedOn: 300, attemptsMade: 2,
    failedReason: 'secret database credentials', opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    returnvalue: { accepted: 4 } };
  const delayed = publicJob(input, 'delayed');
  assert.equal(delayed.retryBackoffMs, 2000);
  assert.equal(delayed.maxAttempts, 3);
  assert.equal(JSON.stringify(delayed).includes('credentials'), false);
  assert.equal('data' in delayed, false);
  assert.deepEqual(publicJob(input, 'completed').result, { accepted: 4 });
});

test('private read failures return sanitized 503 errors', async () => {
  await withApi([job('a', 'simulation', 1)], async base => {
    for (const path of ['/queue', '/jobs']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes('secret'), false);
    }
  }, true);
});
