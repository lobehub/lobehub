import { After, AfterAll, Before, BeforeAll, Status, setDefaultTimeout } from '@cucumber/cucumber';
import { type Cookie, chromium } from 'playwright';

import { TEST_USER, seedTestUser } from '../support/seedTestUser';
import { startWebServer, stopWebServer } from '../support/webServer';
import { CustomWorld } from '../support/world';

process.env['E2E'] = '1';
// Set default timeout for all steps to 10 seconds
setDefaultTimeout(10_000);

// Store base URL and cached session cookies
let baseUrl: string;
let sessionCookies: Cookie[] = [];

BeforeAll({ timeout: 600_000 }, async function () {
  console.log('🚀 Starting E2E test suite...');

  const PORT = process.env.PORT ? Number(process.env.PORT) : 3006;
  baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  console.log(`Base URL: ${baseUrl}`);

  // Seed test user before starting web server
  await seedTestUser();

  // Start web server if not using external BASE_URL
  if (!process.env.BASE_URL) {
    await startWebServer({
      command: `bunx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    });
  }

  // Login once and cache the session cookies
  console.log('🔐 Performing one-time login to cache session...');

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to signin page
    await page.goto(`${baseUrl}/signin`, { waitUntil: 'networkidle' });

    // Step 1: Enter email
    console.log('   Step 1: Entering email...');
    const emailInput = page.locator('input[id="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 30_000 });
    await emailInput.fill(TEST_USER.email);

    // Click the next button
    const nextButton = page.locator('form button').first();
    await nextButton.click();

    // Step 2: Wait for password step and enter password
    console.log('   Step 2: Entering password...');
    const passwordInput = page.locator('input[id="password"]').first();
    await passwordInput.waitFor({ state: 'visible', timeout: 30_000 });
    await passwordInput.fill(TEST_USER.password);

    // Click submit button
    const submitButton = page.locator('form button').first();
    await submitButton.click();

    // Wait for navigation away from signin page
    await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    // Cache the session cookies
    sessionCookies = await context.cookies();
    console.log(`✅ Login successful, cached ${sessionCookies.length} cookies`);
  } finally {
    await browser.close();
  }
});

Before(async function (this: CustomWorld, { pickle }) {
  await this.init();

  const testId = pickle.tags.find(
    (tag) =>
      tag.name.startsWith('@COMMUNITY-') ||
      tag.name.startsWith('@AGENT-') ||
      tag.name.startsWith('@HOME-') ||
      tag.name.startsWith('@PAGE-') ||
      tag.name.startsWith('@ROUTES-'),
  );
  console.log(`\n📝 Running: ${pickle.name}${testId ? ` (${testId.name.replace('@', '')})` : ''}`);

  // Setup API mocks before any page navigation
  // await mockManager.setup(this.page);

  // Set cached session cookies to skip login
  if (sessionCookies.length > 0) {
    await this.browserContext.addCookies(sessionCookies);
    console.log('🍪 Session cookies restored');
  }
});

After(async function (this: CustomWorld, { pickle, result }) {
  const testId = pickle.tags
    .find(
      (tag) =>
        tag.name.startsWith('@COMMUNITY-') ||
        tag.name.startsWith('@AGENT-') ||
        tag.name.startsWith('@HOME-') ||
        tag.name.startsWith('@PAGE-') ||
        tag.name.startsWith('@ROUTES-'),
    )
    ?.name.replace('@', '');

  if (result?.status === Status.FAILED) {
    const screenshot = await this.takeScreenshot(`${testId || 'failure'}-${Date.now()}`);
    this.attach(screenshot, 'image/png');

    const html = await this.page.content();
    this.attach(html, 'text/html');

    if (this.testContext.jsErrors.length > 0) {
      const errors = this.testContext.jsErrors.map((e) => e.message).join('\n');
      this.attach(`JavaScript Errors:\n${errors}`, 'text/plain');
    }

    console.log(`❌ Failed: ${pickle.name}`);
    if (result.message) {
      console.log(`   Error: ${result.message}`);
    }
  } else if (result?.status === Status.PASSED) {
    console.log(`✅ Passed: ${pickle.name}`);
  }

  await this.cleanup();
});

AfterAll(async function () {
  console.log('\n🏁 Test suite completed');

  // Stop web server if we started it
  if (!process.env.BASE_URL && process.env.CI) {
    await stopWebServer();
  }
});
