import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAME } from './config.js';

export function createQueue(redisUrl, name = QUEUE_NAME) {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 3000,
  });
  connection.on('error', () => console.error('Redis producer connection error'));
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
  queue.on('error', () => console.error('Queue infrastructure error'));
  return {
    queue,
    async close() {
      try { await queue.close(); } finally { connection.disconnect(); }
    },
  };
}
