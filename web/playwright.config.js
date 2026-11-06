import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
// Keep an already-running development API on 3000 untouched.
const apiPort = 3001;
const run = process.env.JOBPULSE_BROWSER_RUN || randomUUID().replaceAll('-', '');
process.env.JOBPULSE_BROWSER_RUN = run;
process.env.JOBPULSE_TEST_QUEUE = `jobpulse_browser_${run}`;
const testMongo = new URL(process.env.MONGODB_URL || 'mongodb://127.0.0.1:27018/jobpulse');
testMongo.pathname = `/jobpulse_browser_${run}`;
process.env.JOBPULSE_TEST_MONGODB_URL = testMongo.toString();
export default defineConfig({
  testDir: './e2e', timeout: 45000, expect: { timeout: 15000 },
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://localhost:5174', channel: 'chrome', headless: true,
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node --env-file-if-exists=.env test/helpers/frontend-api.js', cwd: root,
      env: { PORT: String(apiPort), APP_ORIGIN: 'http://localhost:5174', MONGODB_URL: testMongo.toString(), JOBPULSE_TEST_QUEUE: process.env.JOBPULSE_TEST_QUEUE },
      url: `http://127.0.0.1:${apiPort}/api/v1/queue`, reuseExistingServer: false, timeout: 20000 },
    { command: 'npm run dev -- --port 5174', env: { PORT: String(apiPort) }, url: 'http://localhost:5174', reuseExistingServer: false, timeout: 20000 },
  ],
});
