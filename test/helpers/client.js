// Cookie/CSRF-aware HTTP client for real Express tests, never a server auth bypass.
export function makeClient(base) {
  let cookie = '';
  let csrf = '';
  let user;
  async function fetch(url, options = {}) {
    const headers = new Headers(options.headers);
    if (cookie) headers.set('Cookie', cookie);
    headers.set('X-JobPulse-Request', '1');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    return globalThis.fetch(url.startsWith('http') ? url : base + url, { ...options, headers });
  }
  return {
    fetch,
    get user() { return user; },
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    async register(email = `test-${crypto.randomUUID()}@example.com`) {
      const response = await fetch('/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Test-only-password-42!' }) });
      if (response.status !== 201) throw new Error(`Registration failed: ${response.status}`);
      const session = await response.json();
      cookie = response.headers.get('set-cookie').split(';')[0]; csrf = session.csrfToken; user = session.user;
      return session;
    },
  };
}
