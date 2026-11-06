// Test-only process: fault injection is never part of the application worker/API.
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { MongoNetworkError } from 'mongodb';
import { createImportStore } from '../../src/imports/store.js';
import { createJobProcessor } from '../../src/processor.js';

const store = createImportStore(process.env.MONGODB_URL);
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', () => {});
const worker = new Worker(process.env.JOBPULSE_TEST_QUEUE, async job => {
  const faultStore = { ...store, async writeBatch(...args) {
    await store.writeBatch(...args);
    // Model a lost acknowledgement after MongoDB applied a batch.
    if ((job.id === process.env.JOBPULSE_TEST_RETRY_ID && job.attemptsMade < 2)
      || job.id === process.env.JOBPULSE_TEST_EXHAUST_ID) {
      throw new MongoNetworkError('Test-only lost write acknowledgement');
    }
  } };
  return createJobProcessor(faultStore)(job);
}, { connection, concurrency: 1 });
worker.on('ready', () => process.send?.({ event: 'ready', pid: process.pid }));
worker.on('active', job => process.send?.({ event: 'active', pid: process.pid, id: job.id, at: Date.now(), attempt: job.attemptsMade }));
worker.on('failed', (job, error) => process.send?.({ event: 'failed', id: job?.id, message: error.message }));
worker.on('error', error => process.send?.({ event: 'infrastructure', message: error.message }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await worker.close(); } finally {
    connection.disconnect();
    await store.close();
    if (process.connected) process.disconnect();
  }
}
process.on('message', message => { if (message === 'close') void close(); });
process.on('disconnect', () => void close());
