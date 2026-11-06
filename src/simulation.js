import { setTimeout as sleep } from 'node:timers/promises';
import { UnrecoverableError } from 'bullmq';

// Inject the delay only for tests; clients cannot alter duration or execute code.
export async function processSimulation(job, delay = sleep) {
  if (job.name !== 'simulation' || !['complete', 'fail'].includes(job.data?.mode)) {
    throw new UnrecoverableError('Unsupported simulation job');
  }
  await job.updateProgress(0);
  for (let step = 1; step <= 10; step += 1) {
    await delay(1000);
    await job.updateProgress(step * 10);
  }
  if (job.data.mode === 'fail') throw new Error('Simulated task failed');
  return { message: 'Simulated task completed', durationSeconds: 10 };
}
