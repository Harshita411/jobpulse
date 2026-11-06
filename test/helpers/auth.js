import { createApp } from '../../src/app.js';
import { COOKIE_NAME, tokenHash } from '../../src/auth/index.js';

export const TEST_OWNER = '10000000-0000-4000-8000-000000000001';
export const TEST_TOKEN = 'a'.repeat(43);
export const TEST_CSRF = 'c'.repeat(43);
// Unit tests exercise the real auth middleware against an injected server-session store.
export function testApp(queue, store = {}) {
  const authStore = {
    sessionByHash: async hash => hash === tokenHash(TEST_TOKEN) ? { _id: hash, userId: TEST_OWNER, csrfToken: TEST_CSRF, expiresAt: new Date(Date.now() + 60000) } : null,
    userById: async () => ({ _id: TEST_OWNER, email: 'unit@example.com' }),
  };
  const data = { rememberJob: async () => {}, ownsJob: async () => true, ownedJobs: async () => [], ...store };
  return createApp(queue, data, { authStore });
}
export function authFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Cookie', `${COOKIE_NAME}=${TEST_TOKEN}`);
  headers.set('X-JobPulse-Request', '1');
  headers.set('X-CSRF-Token', TEST_CSRF);
  return globalThis.fetch(url, { ...options, headers });
}

export function memoryAuthStore() {
  const users = new Map();
  const sessions = new Map();
  return {
    users, sessions,
    async createUser(user) { if ([...users.values()].some(item => item.email === user.email)) throw Object.assign(new Error('duplicate'), { code: 11000 }); users.set(user._id, user); },
    userByEmail: async email => [...users.values()].find(user => user.email === email),
    userById: async id => users.get(id),
    async createSession(session) { sessions.set(session._id, session); },
    sessionByHash: async hash => sessions.get(hash),
    async deleteSession(hash) { sessions.delete(hash); },
  };
}
