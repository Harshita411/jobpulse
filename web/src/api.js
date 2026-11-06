export class ApiError extends Error {
  constructor(message, status = 0, resource = null) { super(message); this.status = status; this.resource = resource; }
}
let csrfToken = null;
export function setSessionCsrf(value) { csrfToken = value; }

async function request(path, options = {}) {
  const resource = path.startsWith('/auth/') ? 'account' : /^\/jobs\//.test(path) ? 'job' : /^\/imports\//.test(path) ? 'import' : null;
  const sessionAtStart = csrfToken;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10000);
  try {
    const headers = new Headers(options.headers);
    headers.set('X-JobPulse-Request', '1');
    if (sessionAtStart) headers.set('X-CSRF-Token', sessionAtStart);
    const response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      headers,
      signal: options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('/auth/') && sessionAtStart === csrfToken) window.dispatchEvent(new Event('jobpulse-session-expired'));
      const messages = {
        DEPENDENCY_UNAVAILABLE: resource === 'account' ? 'Your account is temporarily unavailable. Please try again.'
          : options.method === 'POST' ? 'We couldn’t confirm your submission. Check your job history before trying again.'
            : 'Your data is temporarily unavailable. Please try again.',
        INVALID_CSRF: 'We couldn’t verify this request. Refresh the page and try again.',
        INVALID_ORIGIN: 'We couldn’t verify this request. Refresh the page and try again.',
        INVALID_QUERY: 'Check your search and filters, then try again.',
        INVALID_ID: 'This link isn’t valid. Check the address and try again.',
      };
      const message = resource === 'account' && response.status === 404
        ? 'Account services are temporarily unavailable. Please try again shortly.'
        : messages[body?.error?.code] || body?.error?.message || 'We couldn’t complete your request. Please try again.';
      throw new ApiError(message, response.status, resource);
    }
    if (response.status === 204) return null;
    if (!body) throw new ApiError('We couldn’t load this information. Please try again.');
    return body;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(timeout.signal.aborted ? 'This is taking longer than expected. Please try again.' : 'Unable to connect. Check your connection and try again.');
  } finally { clearTimeout(timer); }
}

export const api = {
  session: () => request('/auth/session'),
  login: data => request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  register: data => request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
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
