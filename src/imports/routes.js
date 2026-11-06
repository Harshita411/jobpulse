import { Router } from 'express';
import multer from 'multer';
import { importIdFor, InvalidCsvError, isImportId, MAX_FILE_BYTES, validateFileBytes } from './csv.js';
import { IMPORT_JOB_OPTIONS } from './processor.js';

export function importRoutes(queue, store) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2, fieldNameSize: 50, headerPairs: 50 },
    fileFilter(_req, file, done) {
      const allowedType = ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype);
      done(allowedType && /\.csv$/i.test(file.originalname) ? null : new InvalidCsvError('Upload a .csv file with a CSV content type'), true);
    },
  }).single('file');
  // Bound simultaneous in-memory upload requests for this local process.
  let uploading = 0;
  router.post('/', (req, res, next) => {
    if (uploading >= 4) return res.status(429).json({ error: { code: 'UPLOAD_BUSY', message: 'Too many uploads; try again later' } });
    uploading += 1;
    let released = false;
    const release = () => { if (!released) { uploading -= 1; released = true; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  }, upload, async (req, res, next) => {
    try {
      if (!req.file) throw new InvalidCsvError('One CSV file is required in the file field');
      validateFileBytes(req.file.buffer);
      const ownerId = req.user.id;
      const importId = importIdFor(req.file.buffer, ownerId);
      await store.putSource(importId, req.file.buffer, ownerId);
      await store.rememberJob(importId, ownerId, 'csv-import');
      await queue.add('csv-import', { importId, ownerId }, { ...IMPORT_JOB_OPTIONS, jobId: importId });
      const statusUrl = `/api/v1/jobs/${importId}`;
      res.location(statusUrl).status(202).json({ jobId: importId, importId, status: 'accepted', statusUrl });
    } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    if (!isImportId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Import ID must be a SHA-256 hex digest' } });
    try {
      const summary = await store.summary(req.params.id, req.user.id);
      if (!summary) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Import not found' } });
      res.json({ ...summary, statusUrl: `/api/v1/jobs/${req.params.id}` });
    } catch (error) { next(error); }
  });
  router.use((error, _req, res, next) => {
    if (error instanceof InvalidCsvError || error instanceof multer.MulterError) {
      const oversized = error.code === 'LIMIT_FILE_SIZE';
      return res.status(oversized ? 413 : 400).json({ error: {
        code: oversized ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
        message: oversized ? 'CSV file exceeds 2 MB' : error instanceof InvalidCsvError ? error.message : 'Expected one file field and no extra fields',
      } });
    }
    next(error);
  });
  return router;
}
