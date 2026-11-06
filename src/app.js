import express from 'express';
import { randomUUID } from 'node:crypto';
import { isJobId, validateSubmission } from './validation.js';
import { isImportId } from './imports/csv.js';
import { importRoutes } from './imports/routes.js';
import { jobReadRoutes, publicJob } from './job-reads.js';

export function createApp(queue, importStore) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { if (req.method === 'GET') res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '2kb' }));
  app.use('/api/v1', jobReadRoutes(queue));
  if (importStore) app.use('/api/v1/imports', importRoutes(queue, importStore));

  app.post('/api/v1/jobs', async (req, res, next) => {
    const invalid = validateSubmission(req.body);
    if (invalid) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: invalid } });
    try {
      const jobId = randomUUID();
      await queue.add('simulation', { mode: req.body.mode }, { jobId });
      const statusUrl = `/api/v1/jobs/${jobId}`;
      res.location(statusUrl).status(202).json({ jobId, status: 'queued', statusUrl });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/jobs/:id', async (req, res, next) => {
    if (!isJobId(req.params.id) && !isImportId(req.params.id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Job ID must be a UUID v4 or import SHA-256 digest' } });
    }
    try {
      // Read state first, then reload fields so a completed state has its result.
      const job = await queue.getJob(req.params.id);
      const state = job ? await job.getState() : 'unknown';
      const snapshot = state === 'unknown' ? null : await queue.getJob(req.params.id);
      if (!snapshot) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      res.json(publicJob(snapshot, state));
    } catch (error) { next(error); }
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body must be valid JSON' } });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Body exceeds 2 KB' } });
    }
    console.error('Infrastructure operation failed:', error.name);
    res.status(503).json({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Could not access a required service; submission outcome may be uncertain' } });
  });
  return app;
}
