import express from 'express';
import { randomUUID } from 'node:crypto';
import { isJobId, validateSubmission } from './validation.js';
import { isImportId } from './imports/csv.js';
import { importRoutes } from './imports/routes.js';
import { jobReadRoutes, publicJob } from './job-reads.js';
import { createAuth } from './auth/index.js';

export function createApp(queue, importStore, { authStore, authConfig } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  app.use((req, res, next) => { if (req.method === 'GET') res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '2kb' }));
  const auth = createAuth(authStore, authConfig);
  app.use('/api/v1/auth', auth.router);
  app.use('/api/v1', auth.authenticate, auth.writeGuard, auth.csrf, auth.apiLimit);
  app.use('/api/v1', jobReadRoutes(queue, importStore));
  if (importStore) app.use('/api/v1/imports', (req, res, next) => req.method === 'POST' ? auth.uploadLimit(req, res, next) : next(), importRoutes(queue, importStore));

  app.post('/api/v1/jobs', async (req, res, next) => {
    const invalid = validateSubmission(req.body);
    if (invalid) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: invalid } });
    try {
      const jobId = randomUUID();
      await importStore.rememberJob(jobId, req.user.id, 'simulation');
      await queue.add('simulation', { mode: req.body.mode, ownerId: req.user.id }, { jobId });
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
      if (!job || job.data?.ownerId !== req.user.id || !await importStore.ownsJob(req.params.id, req.user.id)) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }
      const state = job ? await job.getState() : 'unknown';
      const snapshot = state === 'unknown' ? null : await queue.getJob(req.params.id);
      if (!snapshot || snapshot.data?.ownerId !== req.user.id) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
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
