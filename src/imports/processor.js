import { UnrecoverableError } from 'bullmq';
import { BATCH_SIZE, csvRows, importIdFor, InvalidCsvError, isImportId } from './csv.js';

export function isTransientFailure(error) {
  return ['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoOperationTimeoutError'].includes(error.name)
    || [6, 7, 89, 91, 189, 9001, 10107, 11600, 11602, 13435, 13436,
      'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(error.code)
    || error.hasErrorLabel?.('RetryableWriteError') === true;
}

export async function processCsvImport(job, store) {
  try {
    const importId = job.data?.importId;
    if (job.name !== 'csv-import' || !isImportId(importId) || job.id !== importId) {
      throw new InvalidCsvError('Invalid import job');
    }
    const source = await store.getSource(importId);
    if (!source || importIdFor(source) !== importId) throw new InvalidCsvError('Import source is missing or does not match its ID');
    // Recompute counts from immutable source on retry; never increment stored counters.
    const counts = { processed: 0, accepted: 0, rejected: 0 };
    let batch = [];
    async function flush() {
      await store.writeBatch(importId, batch);
      await store.checkpoint(importId, counts);
      await job.updateProgress({ ...counts });
      batch = [];
    }
    for await (const row of csvRows(source)) {
      counts.processed += 1;
      if (row.record) { counts.accepted += 1; batch.push(row); }
      else counts.rejected += 1;
      if (counts.processed % BATCH_SIZE === 0) await flush();
    }
    if (counts.processed % BATCH_SIZE) await flush();
    await store.checkpoint(importId, counts, true);
    return { importId, ...counts };
  } catch (error) {
    if (error instanceof UnrecoverableError) throw error;
    if (isTransientFailure(error)) throw error;
    // Redis connection errors during progress updates should also receive bounded retries.
    if (/^(Connection is closed|Stream isn't writeable|Command timed out)/.test(error.message)) throw error;
    throw new UnrecoverableError(error instanceof InvalidCsvError ? error.message : 'Import processing failed');
  }
}

export const IMPORT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: false,
  removeOnFail: false,
});
