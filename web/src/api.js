export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function request(path, options = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(body?.error?.message || `API request failed (${response.status}). Check that Express is running.`, response.status);
    if (!body) throw new ApiError('The API returned an unreadable response.');
    return body;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(timeout.signal.aborted ? 'The API took too long to respond. Check your local services.' : 'Cannot reach the API. Start Express and check your local services.');
  } finally { clearTimeout(timer); }
}

export const api = {
  queue: signal => request('/queue', { signal }),
  jobs: (filters = {}, signal) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
    return request(`/jobs?${query}`, { signal });
  },
  job: (id, signal) => request(`/jobs/${encodeURIComponent(id)}`, { signal }),
  summary: (id, signal) => request(`/imports/${encodeURIComponent(id)}`, { signal }),
  simulation: mode => request('/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'simulation', mode }),
  }),
  upload: file => {
    const body = new FormData();
    // OS/browser MIME detection varies for .csv. Bytes are checked before this normalization.
    body.append('file', new Blob([file], { type: 'text/csv' }), file.name);
    return request('/imports', { method: 'POST', body });
  },
};

export async function validateCsvFile(file) {
  if (!file) return 'Choose a CSV file to continue.';
  if (!/\.csv$/i.test(file.name)) return 'Choose a file with a .csv extension.';
  if (!file.size) return 'The CSV file is empty.';
  if (file.size > 2 * 1024 * 1024) return 'The file exceeds the 2 MB limit.';
  if (file.type && !['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type)) return 'The selected file does not have a supported CSV content type.';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return 'The file contains binary data. Use UTF-8 CSV text.';
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return 'The file must use UTF-8 encoding.'; }
  return null;
}
