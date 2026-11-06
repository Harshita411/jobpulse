import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { MAX_FILE_BYTES, importIdFor } from '../src/imports/csv.js';

async function withApi(queue, store, run) {
  const server = createApp(queue, store).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function form(content, filename = 'test.csv', type = 'text/csv') {
  const body = new FormData();
  body.append('file', new Blob([content], { type }), filename);
  return body;
}
const csv = 'name,email,age\nA,a@example.com,30\n';

test('CSV submission persists source before enqueue, uses stable ID and server-controlled retries', async () => {
  const events = [];
  const store = { async putSource(id, buffer) { events.push(['source', id]); assert.equal(buffer.toString(), csv); } };
  const queue = { async add(type, data, options) { events.push(['queue', data.importId]); assert.equal(type, 'csv-import'); assert.equal(options.attempts, 3); assert.equal(options.backoff.type, 'exponential'); } };
  await withApi(queue, store, async base => {
    for (let i = 0; i < 2; i += 1) {
      const response = await fetch(`${base}/api/v1/imports`, { method: 'POST', body: form(csv) });
      assert.equal(response.status, 202);
      const result = await response.json();
      assert.equal(result.importId, importIdFor(Buffer.from(csv)));
      assert.equal(response.headers.get('location'), result.statusUrl);
    }
  });
  assert.deepEqual(events.map(event => event[0]), ['source', 'queue', 'source', 'queue']);
});

test('upload rejects missing file, wrong extension/MIME, extra fields, binary and oversized files', async () => {
  const queue = { async add() { assert.fail('must not enqueue'); } };
  const store = { async putSource() { assert.fail('must not store'); } };
  await withApi(queue, store, async base => {
    const extra = form(csv); extra.append('command', 'anything');
    for (const [body, status] of [
      [new FormData(), 400], [form(csv, 'test.exe'), 400],
      [form(csv, 'test.csv', 'application/octet-stream'), 400], [extra, 400],
      [form(new Uint8Array([0, 1, 2])), 400],
      [form(new Uint8Array(MAX_FILE_BYTES + 1)), 413],
    ]) {
      const response = await fetch(`${base}/api/v1/imports`, { method: 'POST', body });
      assert.equal(response.status, status, await response.text());
    }
  });
});

test('MongoDB and Redis failures never produce false 202, and durable summary excludes bytes', async () => {
  for (const failure of ['store', 'queue']) {
    const store = { async putSource() { if (failure === 'store') throw new Error('secret'); } };
    const queue = { async add() { throw new Error('secret'); } };
    await withApi(queue, store, async base => {
      const response = await fetch(`${base}/api/v1/imports`, { method: 'POST', body: form(csv) });
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes('secret'), false);
    });
  }
  const id = importIdFor(Buffer.from(csv));
  await withApi({}, { summary: async () => ({ _id: id, processed: 3, accepted: 2, rejected: 1 }) }, async base => {
    const response = await fetch(`${base}/api/v1/imports/${id}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).processed, 3);
  });
});
