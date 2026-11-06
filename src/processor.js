import { UnrecoverableError } from 'bullmq';
import { processSimulation } from './simulation.js';
import { processCsvImport } from './imports/processor.js';

export function createJobProcessor(importStore) {
  return async job => {
    if (job.name === 'simulation') return processSimulation(job);
    if (job.name === 'csv-import') return processCsvImport(job, importStore);
    throw new UnrecoverableError('Unsupported job type');
  };
}
