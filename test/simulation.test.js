import test from 'node:test';
import assert from 'node:assert/strict';
import { processSimulation } from '../src/simulation.js';
import { loadConfig } from '../src/config.js';

test('simulation takes ten one-second steps and reaches 100 percent', async () => {
  const progress = [];
  const delays = [];
  const result = await processSimulation({
    name: 'simulation', data: { mode: 'complete' }, updateProgress: async value => progress.push(value),
  }, async ms => delays.push(ms));
  assert.deepEqual(progress, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.deepEqual(delays, Array(10).fill(1000));
  assert.equal(result.durationSeconds, 10);
});

test('controlled failure throws after all ten steps', async () => {
  let progress;
  await assert.rejects(processSimulation({
    name: 'simulation', data: { mode: 'fail' }, updateProgress: async value => { progress = value; },
  }, async () => {}), /Simulated task failed/);
  assert.equal(progress, 100);
});

test('worker rejects unsupported jobs before executing', async () => {
  await assert.rejects(processSimulation({ name: 'execute-code', data: {} }), /Unsupported/);
});

test('configuration rejects invalid port and protocol', () => {
  assert.equal(loadConfig({ REDIS_URL: 'redis://127.0.0.1:6380' }).port, 3000);
  assert.equal(loadConfig({ REDIS_URL: 'redis://127.0.0.1:6380' }).redisUrl, 'redis://127.0.0.1:6380');
  assert.throws(() => loadConfig({}), /REDIS_URL is required/);
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ REDIS_URL: 'http://localhost' }), /REDIS_URL/);
});
