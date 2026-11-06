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
  return { port, redisUrl, mongodbUrl };
}
