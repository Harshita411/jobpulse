import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { publicJob, HISTORY_LIMIT_PER_STATE } from '../src/job-reads.js';

async function withApi(queue, run) {
  const server = createApp(queue).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/v1`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const job = (id, type, timestamp) => ({ id, name: type, timestamp, progress: 0, opts: { attempts: 3 } });

test('queue statistics include delayed/paused/prioritized records without inventing totals', async () => {
  await withApi({ name: 'test-queue', async getJobCounts() {
    return { wait: 1, paused: 2, prioritized: 1, active: 2, completed: 4, failed: 1, delayed: 3, 'waiting-children': 2 };
  }, isPaused: async () => true }, async base => {
    const response = await fetch(`${base}/queue`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.counts, { waiting: 4, active: 2, completed: 4, failed: 1, delayed: 3, waitingChildren: 2 });
    assert.equal(body.total, 16);
    assert.equal(body.paused, true);
    assert.equal(body.source, 'retained-bullmq-jobs');
  });
});

test('job history filters, searches, sorts, deduplicates and paginates real queue snapshots', async () => {
  const groups = { wait: [job('aaa', 'csv-import', 200)], active: [job('aaa', 'csv-import', 200)],
    completed: [job('ccc', 'simulation', 300), job('bbb', 'csv-import', 100)] };
  await withApi({ getJobCounts: async () => ({ completed: 2 }), async getJobs([state], start, end, ascending) {
    assert.equal(start, 0); assert.equal(end, HISTORY_LIMIT_PER_STATE - 1); assert.equal(ascending, false);
    return groups[state] ?? [];
  } }, async base => {
    let body = await (await fetch(`${base}/jobs?pageSize=1`)).json();
    assert.equal(body.total, 3); assert.equal(body.items[0].jobId, 'ccc'); assert.equal(body.pageSize, 1);
    body = await (await fetch(`${base}/jobs?page=2&pageSize=1`)).json();
    assert.equal(body.items[0].state, 'active');
    body = await (await fetch(`${base}/jobs?type=csv-import&status=completed&search=BB`)).json();
    assert.equal(body.total, 1); assert.equal(body.items[0].jobId, 'bbb');
    body = await (await fetch(`${base}/jobs?search=no-match`)).json();
    assert.deepEqual(body.items, []); assert.equal(body.total, 0);
  });
});

test('history limits are explicit and query validation rejects malformed/unsupported values', async () => {
  await withApi({ getJobCounts: async () => ({ completed: HISTORY_LIMIT_PER_STATE + 1 }), getJobs: async () => [] }, async base => {
    const body = await (await fetch(`${base}/jobs`)).json();
    assert.equal(body.truncated, true); assert.equal(body.limitPerState, HISTORY_LIMIT_PER_STATE);
    for (const query of ['status=made-up', 'type=shell', 'page=-1', 'page=1.1', 'pageSize=51', 'page=1&page=2', 'unknown=1', `search=${'x'.repeat(129)}`]) {
      assert.equal((await fetch(`${base}/jobs?${query}`)).status, 400, query);
    }
  });
});

test('public job metadata exposes retry state, preserves results and sanitizes error details', () => {
  const input = { ...job('abc', 'csv-import', 100), processedOn: 300, attemptsMade: 2,
    failedReason: 'secret database credentials', opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    data: { private: 'must not leak' }, returnvalue: { accepted: 4 } };
  const delayed = publicJob(input, 'delayed');
  assert.equal(delayed.retryBackoffMs, 2000);
  assert.equal(delayed.maxAttempts, 3);
  assert.equal(delayed.type, 'csv-import');
  assert.equal(JSON.stringify(delayed).includes('credentials'), false);
  assert.equal('data' in delayed, false);
  assert.deepEqual(publicJob(input, 'completed').result, { accepted: 4 });
});

test('read endpoint infrastructure failures return sanitized 503 errors', async () => {
  await withApi({ getJobCounts: async () => { throw new Error('private secret'); }, getJobs: async () => [], isPaused: async () => false }, async base => {
    for (const path of ['/queue', '/jobs']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes('secret'), false);
    }
  });
});
