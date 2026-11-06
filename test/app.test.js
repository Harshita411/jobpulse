import test from 'node:test';
import assert from 'node:assert/strict';
import { testApp as createApp, authFetch as fetch, TEST_OWNER } from './helpers/auth.js';

async function withApi(queue, run) {
  const server = createApp(queue).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const id = '40c43481-1cc7-40a2-9756-c6c66a553498';

test('POST acknowledges only after enqueue and supplies Location', async () => {
  let submission;
  await withApi({ async add(...args) { submission = args; } }, async base => {
    const response = await fetch(`${base}/api/v1/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'simulation', mode: 'fail' }),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.statusUrl, response.headers.get('location'));
    assert.equal(submission[0], 'simulation');
    assert.deepEqual(submission[1], { mode: 'fail', ownerId: TEST_OWNER });
    assert.equal(submission[2].jobId, body.jobId);
  });
});

test('invalid submissions never reach queue', async () => {
  await withApi({ add() { assert.fail('must not enqueue'); } }, async base => {
    for (const body of [{ type: 'code', mode: 'complete' }, { type: 'simulation', mode: 'complete', code: 'evil' }, {}, null]) {
      const response = await fetch(`${base}/api/v1/jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const malformed = await fetch(`${base}/api/v1/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    const large = await fetch(`${base}/api/v1/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(3000) }),
    });
    assert.equal(large.status, 413);
  });
});

test('queue rejection returns 503 rather than false acceptance', async () => {
  await withApi({ async add() { throw new Error('internal secret'); } }, async base => {
    const response = await fetch(`${base}/api/v1/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'simulation', mode: 'complete' }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('internal secret'), false);
  });
});

test('GET exposes completed result, failed error, active progress, missing and invalid IDs', async () => {
  let state = 'completed';
  await withApi({ async getJob() {
    return state === 'missing' ? undefined : {
      id, data: { ownerId: TEST_OWNER }, progress: 60, returnvalue: { ok: true }, failedReason: 'Simulated task failed', getState: async () => state,
    };
  } }, async base => {
    for (const nextState of ['completed', 'active', 'failed']) {
      state = nextState;
      const response = await fetch(`${base}/api/v1/jobs/${id}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.state, state);
      assert.equal(body.progress, 60);
      assert.deepEqual(body.result, state === 'completed' ? { ok: true } : null);
      assert.deepEqual(body.error, state === 'failed' ? { message: 'Simulated task failed' } : null);
    }
    state = 'missing';
    assert.equal((await fetch(`${base}/api/v1/jobs/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/jobs/not-a-uuid`)).status, 400);
  });
});
