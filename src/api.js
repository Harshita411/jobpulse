import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createQueue } from './queue.js';
import { createImportStore } from './imports/store.js';
import { createAuthStore } from './auth/store.js';

const config = loadConfig();
const resources = createQueue(config.redisUrl);
const importStore = createImportStore(config.mongodbUrl);
const authStore = createAuthStore(config.mongodbUrl);
const server = createApp(resources.queue, importStore, { authStore, authConfig: config.auth }).listen(config.port, '127.0.0.1', () => {
  console.log(`JobPulse API listening on http://127.0.0.1:${config.port}`);
});
// Bound slow/incomplete upload requests as well as the multipart file size.
server.requestTimeout = 15000;
server.on('error', async error => {
  console.error('API server error:', error.code);
  await resources.close();
  await importStore.close();
  await authStore.close();
  process.exitCode = 1;
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => { await resources.close(); await importStore.close(); await authStore.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
