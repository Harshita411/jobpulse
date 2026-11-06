export const QUEUE_NAME = 'jobpulse-jobs';

export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required; set it in the root .env file or environment');
  const url = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const mongodbUrl = env.MONGODB_URL ?? 'mongodb://127.0.0.1:27018/jobpulse';
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongodbUrl)) throw new Error('MONGODB_URL must be a MongoDB URL');
  const sessionMinutes = Number(env.SESSION_TTL_MINUTES ?? 30);
  if (!Number.isInteger(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 60) throw new Error('SESSION_TTL_MINUTES must be between 5 and 60');
  if (env.SESSION_COOKIE_SECURE && !['true', 'false'].includes(env.SESSION_COOKIE_SECURE)) throw new Error('SESSION_COOKIE_SECURE must be true or false');
  const appOrigin = env.APP_ORIGIN || 'http://localhost:5173';
  const parsedOrigin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== appOrigin) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');
  return { port, redisUrl, mongodbUrl, auth: { port, appOrigin, sessionMinutes, secureCookie: env.SESSION_COOKIE_SECURE === 'true' } };
}
