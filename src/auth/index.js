import { Router } from 'express';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

export const COOKIE_NAME = 'jobpulse_session';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
const dummyHash = bcrypt.hash('JobPulse dummy account password', 12);
const safeUser = user => ({ id: user._id, email: user.email });

export function credentials(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['email', 'password'].includes(key))
    || typeof body.email !== 'string' || typeof body.password !== 'string') return null;
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || [...body.password].length < 12 || Buffer.byteLength(body.password, 'utf8') > 72 || body.password.includes('\0')) return null;
  return { email, password: body.password };
}

export function readSessionToken(req) {
  const cookies = (req.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (cookies.length !== 1) return null;
  const value = cookies[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function createAuth(store, config = {}) {
  const ttlMs = (config.sessionMinutes ?? 30) * 60000;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.secureCookie ?? false, path: '/api' };
  const origins = new Set([config.appOrigin || 'http://localhost:5173', `http://localhost:${config.port ?? 3000}`, `http://127.0.0.1:${config.port ?? 3000}`]);
  function reject(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
  function writeGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-jobpulse-request') !== '1' || (req.get('origin') && !origins.has(req.get('origin')))) {
      return reject(res, 403, 'INVALID_ORIGIN', 'Request origin or request header is not allowed');
    }
    next();
  }
  async function authenticate(req, res, next) {
    try {
      const token = readSessionToken(req);
      const session = token && store ? await store.sessionByHash(tokenHash(token)) : null;
      const user = session && session.expiresAt > new Date() ? await store.userById(session.userId) : null;
      if (!user) return reject(res, 401, 'UNAUTHENTICATED', 'Sign in to continue. Your session may have expired.');
      req.user = safeUser(user);
      req.authSession = session;
      next();
    } catch (error) { next(error); }
  }
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('x-csrf-token') || '';
    const expected = req.authSession.csrfToken;
    if (typeof expected !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || supplied.length !== expected.length
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return reject(res, 403, 'INVALID_CSRF', 'Session verification failed. Reload and try again.');
    }
    next();
  }
  function limiter(limit, windowMs = 15 * 60000, keyGenerator) {
    return rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
      ...(keyGenerator ? { keyGenerator } : {}),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
    });
  }
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(writeGuard);
  const loginIpLimit = limiter(config.loginLimit ?? 40);
  const accountLimit = limiter(config.accountLimit ?? 10, 15 * 60000, req => `${ipKeyGenerator(req.ip)}:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''}`);
  const registerLimit = limiter(config.registerLimit ?? 20);
  async function startSession(req, res, user, status) {
    const old = readSessionToken(req);
    if (old) await store.deleteSession(tokenHash(old));
    const token = randomBytes(32).toString('base64url');
    const session = { _id: tokenHash(token), userId: user._id, csrfToken: randomBytes(32).toString('base64url'),
      createdAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) };
    await store.createSession(session);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ttlMs });
    res.status(status).json({ user: safeUser(user), csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  }
  router.post('/register', registerLimit, async (req, res, next) => {
    const input = credentials(req.body);
    if (!input) return reject(res, 400, 'INVALID_CREDENTIALS_INPUT', 'Use a valid email and a password of at least 12 characters and at most 72 UTF-8 bytes');
    try {
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = { _id: randomUUID(), email: input.email, passwordHash, createdAt: new Date() };
      try { await store.createUser(user); }
      catch (error) { if (error.code === 11000) return reject(res, 409, 'REGISTRATION_FAILED', 'Unable to register with those details'); throw error; }
      await startSession(req, res, user, 201);
    } catch (error) { next(error); }
  });
  router.post('/login', loginIpLimit, accountLimit, async (req, res, next) => {
    const input = credentials(req.body);
    if (!input) return reject(res, 400, 'INVALID_CREDENTIALS_INPUT', 'Use a valid email and password (12 characters to 72 UTF-8 bytes)');
    try {
      const user = await store.userByEmail(input.email);
      const hasHash = typeof user?.passwordHash === 'string' && user.passwordHash.length === 60;
      const valid = await bcrypt.compare(input.password, hasHash ? user.passwordHash : await dummyHash);
      if (!user || !hasHash || !valid) return reject(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      await startSession(req, res, user, 200);
    } catch (error) { next(error); }
  });
  router.get('/session', limiter(150, 60000), authenticate, (req, res) => res.json({ user: req.user, csrfToken: req.authSession.csrfToken, expiresAt: req.authSession.expiresAt }));
  router.post('/logout', authenticate, csrf, async (req, res, next) => {
    try { await store.deleteSession(req.authSession._id); res.clearCookie(COOKIE_NAME, cookieOptions); res.sendStatus(204); }
    catch (error) { next(error); }
  });
  return { router, writeGuard, authenticate, csrf,
    apiLimit: limiter(300, 60000, req => req.user.id), uploadLimit: limiter(10, 60000, req => req.user.id) };
}
