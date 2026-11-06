import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let worker;
test.beforeAll(async () => {
  worker = fork(new URL('../../test/helpers/import-worker.js', import.meta.url), [], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    execArgv: ['--env-file-if-exists=.env'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, MONGODB_URL: process.env.JOBPULSE_TEST_MONGODB_URL,
      JOBPULSE_TEST_RETRY_ID: '', JOBPULSE_TEST_EXHAUST_ID: '' },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local worker did not become ready')), 10000);
    worker.on('message', message => { if (message.event === 'ready') { clearTimeout(timer); resolve(); } });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited: ${code}`)); });
    worker.stderr.on('data', () => {});
  });
});
test.afterAll(async () => {
  if (worker && worker.exitCode === null && worker.connected) { const exit = once(worker, 'exit'); worker.send('close'); await exit; }
});

test('real CSV upload navigates to details, completes and appears in results', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/submit');
  const bytes = await readFile(new URL('../../samples/mixed.csv', import.meta.url));
  const source = bytes.toString().replace('Ada Lovelace', `Browser ${Date.now()}`);
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'browser-mixed.csv', mimeType: 'text/csv', buffer: Buffer.from(source) });
  await expect(page.getByText('Ready to upload', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Submit job', exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9]{64}$/);
  const importId = page.url().split('/').at(-1);
  await expect(page.locator('.status-completed')).toBeVisible();
  await expect(page.locator('.row-stats')).toContainText('5');
  await expect(page.locator('.row-stats')).toContainText('2');
  await expect(page.locator('.row-stats')).toContainText('3');
  await expect(page.locator('.json-result')).toContainText('"accepted": 2');
  await page.getByRole('link', { name: 'Browse completed results' }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `View result ${importId}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('history search and type/state filters use backend data', async ({ page }) => {
  const response = await page.request.post('/api/v1/imports', { multipart: { file: {
    name: 'history-test.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`name,email,age\nHistory ${Date.now()},history@example.com,30\n`),
  } } });
  expect(response.status()).toBe(202);
  const { importId } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${importId}`)).json()).state).toBe('completed');
  await page.goto('/jobs');
  await page.getByRole('combobox', { name: 'Filter by type' }).selectOption('csv-import');
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('completed');
  await page.getByLabel('Search job ID or type').fill(importId);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('link', { name: `View job ${importId}` })).toBeVisible();
  await page.getByLabel('Search job ID or type').fill(`no-match-${importId}`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching jobs' })).toBeVisible();
});

test('simulation supports success and controlled failure with live polling', async ({ page }) => {
  for (const mode of ['complete', 'fail']) {
    await page.goto('/submit');
    await page.getByRole('radio', { name: 'Simulation', exact: false }).check();
    if (mode === 'fail') await page.getByRole('radio', { name: 'Fail in a controlled way', exact: false }).check();
    await page.getByRole('button', { name: 'Submit job', exact: true }).click();
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
    await expect(page.locator(mode === 'complete' ? '.status-completed' : '.status-failed')).toBeVisible({ timeout: 20000 });
    if (mode === 'fail') await expect(page.getByText('Simulated task failed', { exact: true })).toBeVisible();
  }
});

test('upload validation and missing-job state provide useful feedback', async ({ page }) => {
  await page.goto('/submit');
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not a csv') });
  await expect(page.getByRole('alert')).toContainText('.csv extension');
  await expect(page.getByRole('button', { name: 'Submit job', exact: true })).toBeDisabled();
  await page.goto('/jobs/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Job not found');
});

test('unavailable API shows an error instead of zero metrics', async ({ page }) => {
  await page.route('**/api/v1/queue', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Cannot reach the API');
  await expect(page.locator('.stat-card')).toHaveCount(0);
});

test('all five pages meet automated accessibility checks', async ({ page }, testInfo) => {
  const response = await page.request.post('/api/v1/imports', { multipart: { file: {
    name: 'accessibility.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`name,email,age\nAccessible ${Date.now()},accessible@example.com,24\nInvalid,not-an-email,500\n`),
  } } });
  expect(response.status()).toBe(202);
  const { importId } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${importId}`)).json()).state).toBe('completed');
  for (const route of ['/', '/submit', '/jobs', '/results', `/jobs/${importId}`]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    if (route === '/') await expect(page.locator('.stat-card')).toHaveCount(4);
    if (route.startsWith('/jobs/')) await expect(page.locator('.row-stats')).toBeVisible();
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    await page.screenshot({ path: testInfo.outputPath(route === '/' ? 'dashboard.png' : `${route.replaceAll('/', '-')}.png`), fullPage: true });
    expect(report.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, message: node.failureSummary })) }))).toEqual([]);
  }
});

test('mobile navigation and layouts work without horizontal overflow', async ({ page }, testInfo) => {
  const receipt = await (await page.request.post('/api/v1/imports', { multipart: { file: {
    name: 'mobile.csv', mimeType: 'text/csv', buffer: Buffer.from(`name,email,age\nMobile ${Date.now()},mobile@example.com,30\n`),
  } } })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${receipt.importId}`)).json()).state).toBe('completed');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.stat-card')).toHaveCount(4);
  const overflow = await page.evaluate(() => ({ width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), viewport: window.innerWidth,
    elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 15).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, parent: element.parentElement.className, overflow: getComputedStyle(element.parentElement).overflow, width: element.clientWidth, scroll: element.scrollWidth })),
    frames: [...document.querySelectorAll('body,#root,.app-shell,.workspace-main,main,.table-scroll')].map(element => ({ tag: element.tagName, class: element.className, width: element.clientWidth, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflow })) }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({ path: testInfo.outputPath('mobile-dashboard.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Submit job' }).click();
  await expect(page.getByRole('heading', { name: 'Submit a job' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
