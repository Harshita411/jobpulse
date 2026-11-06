import { Router } from 'express';

const FILTER_STATES = ['waiting', 'active', 'delayed', 'completed', 'failed', 'waiting-children'];

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

// Ownership comes from MongoDB's server-written catalog AND the queue payload.
async function ownedSnapshots(queue, store, ownerId) {
  const refs = await store.ownedJobs(ownerId);
  const snapshots = [];
  // Bound concurrency, not ownership: other users never influence this read window.
  for (let start = 0; start < refs.length; start += 10) {
    const batch = await Promise.all(refs.slice(start, start + 10).map(async ref => {
      const job = await queue.getJob(ref._id);
      if (!job || job.data?.ownerId !== ownerId) return null;
      const state = await job.getState();
      if (state === 'unknown') return null;
      return publicJob(job, state);
    }));
    snapshots.push(...batch.filter(Boolean));
  }
  return snapshots;
}

export function jobReadRoutes(queue, store) {
  const router = Router();
  router.get('/queue', async (req, res, next) => {
    try {
      const jobs = await ownedSnapshots(queue, store, req.user.id);
      const counts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, waitingChildren: 0 };
      for (const job of jobs) {
        const key = job.state === 'prioritized' ? 'waiting' : job.state === 'waiting-children' ? 'waitingChildren' : job.state;
        if (key in counts) counts[key] += 1;
      }
      res.json({ queue: queue.name, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        paused: await queue.isPaused(), observedAt: Date.now(), source: 'retained-owned-bullmq-jobs' });
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
      const jobs = await ownedSnapshots(queue, store, req.user.id);
      const needle = search.toLowerCase().trim();
      const matches = jobs.filter(job =>
        (!status || job.state === status || (status === 'waiting' && job.state === 'prioritized'))
        && (!type || job.type === type)
        && (!needle || job.jobId.toLowerCase().includes(needle) || job.type.includes(needle)))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.jobId.localeCompare(b.jobId));
      const offset = (Number(page) - 1) * Number(pageSize);
      res.json({ items: matches.slice(offset, offset + Number(pageSize)), total: matches.length,
        page: Number(page), pageSize: Number(pageSize), truncated: false, observedAt: Date.now() });
    } catch (error) { next(error); }
  });
  return router;
}
