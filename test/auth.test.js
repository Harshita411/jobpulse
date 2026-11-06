import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { credentials, COOKIE_NAME, tokenHash } from '../src/auth/index.js';
import { memoryAuthStore } from './helpers/auth.js';
import { makeClient } from './helpers/client.js';

async function withApp(run, authConfig = {}) {
  const authStore = memoryAuthStore();
  const server = createApp({}, {}, { authStore, authConfig }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base, authStore); } finally { await new Promise(resolve => server.close(resolve)); }
}
const password = 'Test-only-password-42!';
function post(base, path, data, headers = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobPulse-Request': '1', ...headers }, body: JSON.stringify(data) });
}

test('credentials reject owner injection, weak/oversized/non-string inputs and normalize email', () => {
  assert.equal(credentials({ email: 'a@example.com', password, ownerId: 'chosen' }), null);
  for (const value of ['', 'short', 'x'.repeat(73), '🙂'.repeat(19), { $ne: '' }]) assert.equal(credentials({ email: 'a@example.com', password: value }), null);
  assert.equal(credentials({ email: { $ne: '' }, password }), null);
  assert.equal(credentials({ email: ' A@Example.com ', password }).email, 'a@example.com');
});

test('registration hashes passwords and issues a bounded HttpOnly SameSite session; logout revokes it', async () => {
  await withApp(async (base, store) => {
    const client = makeClient(base);
    const session = await client.register('new@example.com');
    const user = [...store.users.values()][0];
    assert.notEqual(user.passwordHash, password);
    assert.equal(await bcrypt.compare(password, user.passwordHash), true);
    assert.equal(JSON.stringify(session).includes('passwordHash'), false);
    assert.equal(store.sessions.has(tokenHash(client.cookie.split('=')[1])), true);
    assert.equal([...store.sessions.keys()].some(key => key === client.cookie.split('=')[1]), false);
    const restored = await client.fetch('/api/v1/auth/session');
    assert.equal(restored.status, 200);
    assert.deepEqual((await restored.json()).user, session.user);
    const logout = await client.fetch('/api/v1/auth/logout', { method: 'POST' });
    assert.equal(logout.status, 204);
    assert.equal((await client.fetch('/api/v1/auth/session')).status, 401);
  });
});

test('cookie flags, session rotation, invalid credentials, tampering and expiry are enforced', async () => {
  await withApp(async (base, store) => {
    const registration = await post(base, '/api/v1/auth/register', { email: 'owner@example.com', password });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api/); assert.match(cookie, /Max-Age=1800/);
    const original = cookie.split(';')[0];
    for (const email of ['owner@example.com', 'missing@example.com']) {
      const result = await post(base, '/api/v1/auth/login', { email, password: 'Wrong-password-42!' });
      assert.equal(result.status, 401);
      assert.equal((await result.json()).error.message, 'Email or password is incorrect');
    }
    const login = await post(base, '/api/v1/auth/login', { email: 'OWNER@example.com', password }, { Cookie: original });
    assert.equal(login.status, 200);
    const replacement = login.headers.get('set-cookie').split(';')[0];
    assert.notEqual(original, replacement);
    assert.equal((await fetch(base + '/api/v1/auth/session', { headers: { Cookie: original } })).status, 401);
    assert.equal((await fetch(base + '/api/v1/auth/session', { headers: { Cookie: `${COOKIE_NAME}=${'z'.repeat(43)}` } })).status, 401);
    assert.equal((await fetch(base + '/api/v1/auth/session', { headers: { Cookie: replacement + ';' + replacement } })).status, 401);
    [...store.sessions.values()][0].expiresAt = new Date(Date.now() - 1);
    assert.equal((await fetch(base + '/api/v1/auth/session', { headers: { Cookie: replacement } })).status, 401);
  });
});

test('private APIs require authentication and writes require origin/custom-header/CSRF checks', async () => {
  await withApp(async base => {
    for (const path of ['/api/v1/jobs', '/api/v1/queue', '/api/v1/imports/abc', '/api/v1/jobs/abc']) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    assert.equal((await post(base, '/api/v1/auth/register', { email: 'a@example.com', password }, { Origin: 'https://evil.example' })).status, 403);
    const client = makeClient(base); await client.register();
    assert.equal((await post(base, '/api/v1/jobs', { type: 'simulation', mode: 'complete' }, { Cookie: client.cookie })).status, 403);
    assert.equal((await post(base, '/api/v1/jobs', {}, { Cookie: client.cookie, 'X-CSRF-Token': 'é'.repeat(43) })).status, 403);
  });
});

test('authentication rate limits return 429 before unbounded password verification', async () => {
  await withApp(async base => {
    const body = { email: 'absent@example.com', password };
    assert.equal((await post(base, '/api/v1/auth/login', body)).status, 401);
    assert.equal((await post(base, '/api/v1/auth/login', body)).status, 401);
    const limited = await post(base, '/api/v1/auth/login', body);
    assert.equal(limited.status, 429); assert.ok(limited.headers.get('ratelimit'));
  }, { loginLimit: 2 });
});

test('a malformed legacy user without a password hash can never authenticate using the dummy password', async () => {
  await withApp(async (base, store) => {
    store.users.set('legacy-placeholder', { _id: 'legacy-placeholder', email: 'legacy@example.com' });
    const response = await post(base, '/api/v1/auth/login', { email: 'legacy@example.com', password: 'JobPulse dummy account password' });
    assert.equal(response.status, 401);
    assert.equal(store.sessions.size, 0);
  });
});
