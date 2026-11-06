// Browser-test bootstrap only: the actual Express app and stores on an isolated queue.
import { createApp } from '../../src/app.js';
import { createQueue } from '../../src/queue.js';
import { createImportStore } from '../../src/imports/store.js';
import { loadConfig } from '../../src/config.js';
import { createAuthStore } from '../../src/auth/store.js';

const config = loadConfig();
if (!process.env.JOBPULSE_TEST_QUEUE?.startsWith('jobpulse_browser_')) throw new Error('An isolated browser-test queue is required');
const resources = createQueue(config.redisUrl, process.env.JOBPULSE_TEST_QUEUE);
const store = createImportStore(config.mongodbUrl);
const authStore = createAuthStore(config.mongodbUrl);
const server = createApp(resources.queue, store, { authStore, authConfig: config.auth }).listen(config.port, '127.0.0.1');
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(async () => { await resources.close(); await store.close(); await authStore.close(); });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
