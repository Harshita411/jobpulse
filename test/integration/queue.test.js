import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createQueue } from '../../src/queue.js';
import { processSimulation } from '../../src/simulation.js';
import { loadConfig } from '../../src/config.js';

test('real Redis: backlog, progress, completion and controlled failure', { timeout: 40000 }, async () => {
  const { redisUrl } = loadConfig();
  // Fail promptly when local Redis is unavailable, before creating retrying clients.
  const probe = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
  } finally {
    probe.disconnect();
  }
  const name = `jobpulse-test-${randomUUID()}`;
  const resources = createQueue(redisUrl, name);
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => {});
  let worker;
  const jobs = [];
  try {
    await resources.queue.waitUntilReady();
    for (const mode of ['complete', 'fail']) {
      jobs.push(await resources.queue.add('simulation', { mode }, { jobId: randomUUID() }));
    }
    assert.equal(await jobs[0].getState(), 'waiting');
    assert.equal(await jobs[1].getState(), 'waiting');
    worker = new Worker(name, job => processSimulation(job), { connection, concurrency: 1 });
    worker.on('error', () => {});
    const observedProgress = [];
    worker.on('progress', (_job, value) => observedProgress.push(value));
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await jobs[1].getState() === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const success = await resources.queue.getJob(jobs[0].id);
    const failure = await resources.queue.getJob(jobs[1].id);
    assert.equal(await success.getState(), 'completed');
    assert.equal(success.returnvalue.durationSeconds, 10);
    assert.equal(await failure.getState(), 'failed');
    assert.equal(failure.failedReason, 'Simulated task failed');
    assert.equal(failure.progress, 100);
    assert.ok(observedProgress.includes(50));
  } finally {
    if (worker) await worker.close();
    connection.disconnect();
    // Remove only this test's own jobs, never flush Redis or other queues.
    for (const job of jobs) await job.remove();
    await resources.close();
  }
});
