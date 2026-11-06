import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let worker;
const password = 'Browser-only-password-42!';
async function registerUi(page, email = `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`) {
  await page.goto('/register');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  return email;
}
async function privatePost(page, path, options) {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  return page.request.post(path, { ...options, headers: { ...options?.headers, 'X-JobPulse-Request': '1', 'X-CSRF-Token': session.csrfToken } });
}
test.beforeEach(async ({ page }, info) => { if (!info.title.startsWith('authentication:')) await registerUi(page); });
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
  await expect(page.locator('.result-summary')).toContainText('2 accepted');
  await expect(page.locator('.result-summary')).toContainText('3 rejected');
  await page.getByRole('link', { name: 'Browse completed results' }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `View result ${importId}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test('history search and type/state filters use backend data', async ({ page }) => {
  const response = await privatePost(page, '/api/v1/imports', { multipart: { file: {
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
  await expect(page.getByRole('alert')).toContainText('Unable to connect');
  await expect(page.locator('.stat-card')).toHaveCount(0);
});

test('all five pages meet automated accessibility checks', async ({ page }, testInfo) => {
  const response = await privatePost(page, '/api/v1/imports', { multipart: { file: {
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
    await expect(page.locator('body')).not.toContainText(/BullMQ|Redis|MongoDB|HttpOnly|Local workspace|Local only|No cloud required|Background work, in view|durable counters|Polling stopped|npm run worker|backend acknowledges/);
    await expect(page.locator('.main-footer,.local-note,.environment,.workspace-switch')).toHaveCount(0);
    if (route === '/') {
      const metrics = await (await page.request.get('/api/v1/queue')).json();
      for (const [index, key] of ['waiting', 'active', 'completed', 'failed'].entries()) {
        await expect(page.locator('.stat-card>strong').nth(index)).toHaveText(new Intl.NumberFormat().format(metrics.counts[key]));
      }
    }
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    await page.screenshot({ path: testInfo.outputPath(route === '/' ? 'dashboard.png' : `${route.replaceAll('/', '-')}.png`), fullPage: true });
    expect(report.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, message: node.failureSummary })) }))).toEqual([]);
  }
});

test('mobile navigation and layouts work without horizontal overflow', async ({ page }, testInfo) => {
  const receipt = await (await privatePost(page, '/api/v1/imports', { multipart: { file: {
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

test('authentication: registration, restoration, logout and two-user CSV privacy', async ({ page, browser }) => {
  const aliceEmail = await registerUi(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain('jobpulse_session');
  const cookie = (await page.context().cookies()).find(item => item.name === 'jobpulse_session');
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict');
  const tab = await page.context().newPage();
  await tab.goto('/jobs');
  await expect(tab.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(tab).toHaveURL('/login');
  await tab.close();
  expect((await page.request.get('/api/v1/jobs')).status()).toBe(401);
  await page.getByLabel('Email address', { exact: true }).fill(aliceEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/');
  const sharedBytes = await readFile(new URL('../../samples/mixed.csv', import.meta.url));
  async function uploadUi(target) {
    await target.goto('/submit');
    await target.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'identical.csv', mimeType: 'text/csv', buffer: sharedBytes });
    await target.getByRole('button', { name: 'Submit job', exact: true }).click();
    await expect(target).toHaveURL(/\/jobs\/[a-f0-9]{64}$/);
    await expect(target.locator('.status-completed')).toBeVisible();
    return target.url().split('/').at(-1);
  }
  const aliceId = await uploadUi(page);
  const bobContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const bob = await bobContext.newPage();
    await registerUi(bob);
    const bobId = await uploadUi(bob);
    expect(bobId).not.toBe(aliceId);
    expect((await bob.request.get(`/api/v1/jobs/${aliceId}`)).status()).toBe(404);
    expect((await bob.request.get(`/api/v1/imports/${aliceId}`)).status()).toBe(404);
    const history = await (await bob.request.get('/api/v1/jobs')).json();
    expect(history.total).toBe(1); expect(history.items[0].jobId).toBe(bobId);
    expect((await (await page.request.get('/api/v1/queue')).json()).total).toBe(1);
    expect((await (await bob.request.get('/api/v1/queue')).json()).total).toBe(1);
    await bob.goto(`/jobs/${aliceId}`);
    await expect(bob.getByRole('alert')).toContainText('Job not found');
    await bobContext.addCookies([{ name: 'jobpulse_session', value: 'x'.repeat(43), domain: 'localhost', path: '/api', httpOnly: true, sameSite: 'Strict' }]);
    await bob.goto('/');
    await expect(bob).toHaveURL('/login');
  } finally { await bobContext.close(); }
});

test('authentication: protected redirects, invalid login and accessible auth forms', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Email address', { exact: true }).fill('unknown@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Unknown-password-42!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(report.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  }
});

test('authentication: polished desktop and mobile forms preserve real registration and login', async ({ page }, testInfo) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.auth-story')).toHaveCSS('background-color', 'rgb(20, 46, 41)');
  expect(await page.locator('.auth-page').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  await expect(page.locator('#password-help')).toContainText('At least 12 characters');
  await expect(page.locator('body')).not.toContainText(/MongoDB|HttpOnly|local-only|Sessions stay|password never enters/);
  await page.screenshot({ path: testInfo.outputPath('registration-desktop.png'), fullPage: true });
  const email = await registerUi(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/register', '/login']) {
    await page.goto(path);
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
    expect(await page.locator('.auth-page').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(path === '/register' ? 'registration-mobile.png' : 'login-mobile.png'), fullPage: true });
  }
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('authentication: missing auth route is a visible recoverable service error, not a missing job', async ({ page }) => {
  // Reproduce the observed stale-API response without changing the real backend contract.
  await page.route('**/api/v1/auth/session', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }) }));
  await page.goto('/register');
  await expect(page.getByRole('alert')).toContainText('Unable to connect to your account');
  await expect(page.getByRole('alert')).toContainText('Account services are temporarily unavailable');
  await expect(page.getByRole('alert')).not.toContainText('find that job');
  await page.unroute('**/api/v1/auth/session');
  const response = await page.request.get('/api/v1/auth/session');
  expect(response.status()).toBe(401); // The route exists; this browser has no session yet.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
  await registerUi(page);
});
