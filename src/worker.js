import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig, QUEUE_NAME } from './config.js';
import { createJobProcessor } from './processor.js';
import { createImportStore } from './imports/store.js';

const { redisUrl, mongodbUrl } = loadConfig();
const importStore = createImportStore(mongodbUrl);
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on('error', () => console.error('Redis worker connection error'));
const worker = new Worker(QUEUE_NAME, createJobProcessor(importStore), {
  connection,
  concurrency: 1,
  maxStalledCount: 1,
});
worker.on('ready', () => console.log(`JobPulse worker ready; pid=${process.pid}; concurrency=1`));
worker.on('active', job => console.log(JSON.stringify({ event: 'active', jobId: job.id, pid: process.pid, type: job.name })));
worker.on('progress', (job, progress) => console.log(JSON.stringify({ event: 'progress', jobId: job.id, progress })));
worker.on('completed', (job, result) => console.log(JSON.stringify({ event: 'completed', jobId: job.id, result })));
worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'failed', jobId: job?.id, error: error.message })));
worker.on('error', error => console.error('Worker infrastructure error:', error.name));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('Draining active job before shutdown');
  try { await worker.close(); } finally { connection.disconnect(); await importStore.close(); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
