import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UnrecoverableError } from 'bullmq';
import { csvRows, importIdFor, MAX_FILE_BYTES, validateFileBytes } from '../src/imports/csv.js';
import { processCsvImport, IMPORT_JOB_OPTIONS } from '../src/imports/processor.js';

const sample = name => readFile(new URL(`../samples/${name}.csv`, import.meta.url));
function harness(source) {
  const records = new Map();
  const batchSizes = [];
  const checkpoints = [];
  const id = importIdFor(source);
  const store = {
    getSource: async () => source,
    async writeBatch(_id, rows) {
      batchSizes.push(rows.length);
      for (const row of rows) records.set(row.rowNumber, row.record);
    },
    async checkpoint(_id, counts, finished) { checkpoints.push({ ...counts, finished }); },
  };
  const progress = [];
  const job = { id, name: 'csv-import', data: { importId: id }, updateProgress: async value => progress.push(value) };
  return { records, store, job, batchSizes, checkpoints, progress };
}

test('CSV parses BOM, quoted commas and newlines; rejects bad rows without rejecting the file', async () => {
  const source = Buffer.from('\ufeffname,email,age\r\n"Doe, Jane",JANE@example.com,25\r\nInvalid,no-email,20\r\n"Two\nLines",line@example.com,40\r\n');
  const rows = [];
  for await (const row of csvRows(source)) rows.push(row);
  assert.deepEqual(rows.map(row => row.rowNumber), [1, 2, 3]);
  assert.deepEqual(rows[0].record, { name: 'Doe, Jane', email: 'jane@example.com', age: 25 });
  assert.equal(rows[1].record, null);
  assert.equal(rows[2].record, null);
});

test('mixed CSV counts accepted and rejected rows correctly', async () => {
  const h = harness(await sample('mixed'));
  const result = await processCsvImport(h.job, h.store);
  assert.deepEqual(result, { importId: h.job.id, processed: 5, accepted: 2, rejected: 3 });
  assert.equal(h.records.size, 2);
  assert.deepEqual(h.progress.at(-1), { processed: 5, accepted: 2, rejected: 3 });
  assert.equal(h.checkpoints.at(-1).finished, true);
});

test('all-invalid rows finish successfully with zero accepted records', async () => {
  const h = harness(Buffer.from('name,email,age\nBad,invalid,20\nNo Age,age@example.com,-1\n'));
  const result = await processCsvImport(h.job, h.store);
  assert.deepEqual(result, { importId: h.job.id, processed: 2, accepted: 0, rejected: 2 });
  assert.equal(h.records.size, 0);
});

test('batch writes are bounded at 100 rows and counters are recomputed on replay', async () => {
  const source = Buffer.from(`name,email,age\n${Array.from({ length: 205 }, (_, i) => `User ${i},user${i}@example.com,30`).join('\n')}\n`);
  const h = harness(source);
  const result = await processCsvImport(h.job, h.store);
  assert.deepEqual(h.batchSizes, [100, 100, 5]);
  assert.deepEqual(await processCsvImport(h.job, h.store), result);
  assert.equal(h.records.size, 205);
  assert.equal(result.processed, result.accepted + result.rejected);
});

test('transient partial write failure is retryable and replay has stable identities/counts', async () => {
  const h = harness(await sample('valid'));
  const write = h.store.writeBatch;
  let fail = true;
  h.store.writeBatch = async (...args) => {
    await write(...args);
    if (fail) { fail = false; throw Object.assign(new Error('lost acknowledgement'), { name: 'MongoNetworkError' }); }
  };
  await assert.rejects(processCsvImport(h.job, h.store), error => error.name === 'MongoNetworkError' && !(error instanceof UnrecoverableError));
  assert.equal(h.checkpoints.length, 0);
  assert.equal((await processCsvImport(h.job, h.store)).accepted, 3);
  assert.equal(h.records.size, 3);
  assert.equal(IMPORT_JOB_OPTIONS.attempts, 3);
  assert.deepEqual(IMPORT_JOB_OPTIONS.backoff, { type: 'exponential', delay: 1000 });
});

test('malformed CSV, bad header, row/record limits and missing source are permanent failures', async () => {
  for (const source of [
    await sample('malformed'), Buffer.from('wrong,email,age\nA,a@example.com,1'),
    Buffer.from('name,email,age\n'),
    Buffer.from(`name,email,age\n${'x'.repeat(17000)},a@example.com,20`),
    Buffer.from(`name,email,age\n${'A,a@example.com,1\n'.repeat(10001)}`),
  ]) {
    const h = harness(source);
    await assert.rejects(processCsvImport(h.job, h.store), UnrecoverableError);
  }
  const h = harness(await sample('valid'));
  h.store.getSource = async () => undefined;
  await assert.rejects(processCsvImport(h.job, h.store), /source is missing/);
});

test('file bytes reject empty, oversized, invalid UTF-8 and binary data; IDs are content stable', () => {
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(MAX_FILE_BYTES + 1), Buffer.from([0xff]), Buffer.from([0])]) {
    assert.throws(() => validateFileBytes(buffer));
  }
  const source = Buffer.from('name,email,age\nA,a@example.com,10\n');
  assert.equal(importIdFor(source), importIdFor(Buffer.from(source)));
  assert.notEqual(importIdFor(source), importIdFor(Buffer.concat([source, Buffer.from('\n')])));
});
