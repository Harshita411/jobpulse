import { Router } from 'express';

const QUEUE_STATES = ['wait', 'paused', 'prioritized', 'active', 'delayed', 'completed', 'failed', 'waiting-children'];
const FILTER_STATES = ['waiting', 'active', 'delayed', 'completed', 'failed', 'waiting-children'];
export const HISTORY_LIMIT_PER_STATE = 500;

export function publicJob(job, state) {
  const knownErrors = ['Simulated task failed', 'Expected CSV header: name,email,age',
    'CSV must include a header and at least one data row', 'CSV exceeds 10000 data rows',
    'Malformed CSV or record exceeds 16 KB', 'Import source is missing or does not match its ID'];
  const attempts = job.opts?.attempts ?? 1;
  const backoff = job.opts?.backoff;
  const retryDelay = state === 'delayed' && backoff?.type === 'exponential'
    ? backoff.delay * 2 ** Math.max(0, (job.attemptsMade ?? 1) - 1) : null;
  return {
    jobId: job.id,
    type: job.name ?? 'unknown',
    state,
    progress: job.progress ?? 0,
    attemptsMade: job.attemptsMade ?? 0,
    maxAttempts: attempts,
    createdAt: job.timestamp ?? null,
    startedAt: job.processedOn ?? null,
    finishedAt: job.finishedOn ?? null,
    retryBackoffMs: retryDelay,
    result: state === 'completed' ? job.returnvalue ?? null : null,
    error: state === 'failed' || (state === 'delayed' && job.failedReason) ? {
      message: knownErrors.includes(job.failedReason) ? job.failedReason : 'Task failed; inspect worker logs',
    } : null,
  };
}

export function jobReadRoutes(queue) {
  const router = Router();
  router.get('/queue', async (_req, res, next) => {
    try {
      const [raw, paused] = await Promise.all([queue.getJobCounts(...QUEUE_STATES), queue.isPaused()]);
      const counts = {
        waiting: (raw.wait ?? 0) + (raw.paused ?? 0) + (raw.prioritized ?? 0),
        active: raw.active ?? 0, completed: raw.completed ?? 0, failed: raw.failed ?? 0,
        delayed: raw.delayed ?? 0, waitingChildren: raw['waiting-children'] ?? 0,
      };
      res.json({ queue: queue.name, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        paused, observedAt: Date.now(), source: 'retained-bullmq-jobs' });
    } catch (error) { next(error); }
  });

  router.get('/jobs', async (req, res, next) => {
    const { status = '', type = '', search = '', page = '1', pageSize = '15' } = req.query;
    const allowedKeys = ['status', 'type', 'search', 'page', 'pageSize'];
    if (Object.keys(req.query).some(key => !allowedKeys.includes(key))
      || [status, type, search, page, pageSize].some(value => typeof value !== 'string')
      || (status && !FILTER_STATES.includes(status))
      || (type && !['simulation', 'csv-import'].includes(type)) || search.length > 128
      || !/^[1-9]\d{0,5}$/.test(page) || !/^[1-9]\d?$/.test(pageSize) || Number(pageSize) > 50) {
      return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Invalid status, type, search, page or pageSize (1–50)' } });
    }
    try {
      // Bounded read-only inspection, not an unbounded Redis scan. Each state has its own ordering.
      const [rawCounts, groups] = await Promise.all([
        queue.getJobCounts(...QUEUE_STATES),
        Promise.all(QUEUE_STATES.map(async state => ({ state,
          jobs: await queue.getJobs([state], 0, HISTORY_LIMIT_PER_STATE - 1, false),
        }))),
      ]);
      const unique = new Map();
      for (const { state, jobs } of groups) for (const job of jobs) {
        if (!job) continue;
        const displayState = ['wait', 'paused'].includes(state) ? 'waiting' : state;
        unique.set(job.id, publicJob(job, displayState));
      }
      const needle = search.toLowerCase().trim();
      const matches = [...unique.values()].filter(job =>
        (!status || job.state === status || (status === 'waiting' && job.state === 'prioritized'))
        && (!type || job.type === type)
        && (!needle || job.jobId.toLowerCase().includes(needle) || job.type.includes(needle)))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.jobId.localeCompare(b.jobId));
      const offset = (Number(page) - 1) * Number(pageSize);
      res.json({ items: matches.slice(offset, offset + Number(pageSize)), total: matches.length,
        page: Number(page), pageSize: Number(pageSize),
        truncated: Object.values(rawCounts).some(count => count > HISTORY_LIMIT_PER_STATE),
        limitPerState: HISTORY_LIMIT_PER_STATE, observedAt: Date.now(),
      });
    } catch (error) { next(error); }
  });
  return router;
}
