import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { type Cookie, request } from 'playwright';

import { mockManager } from '../mocks';
import { seedTestUser, TEST_USER } from '../support/seedTestUser';
import { startWebServer, stopWebServer } from '../support/webServer';
import { closeSharedBrowser, type CustomWorld } from '../support/world';

process.env['E2E'] = '1';
// Set default timeout for all steps to 30 seconds
setDefaultTimeout(30_000);

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

  console.log('🔐 Signing in once through the auth API...');
  const api = await request.newContext({ baseURL: baseUrl });

  try {
    const response = await api.post('/api/auth/sign-in/email', {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
    });

    if (!response.ok()) {
      throw new Error(`Auth API sign-in failed: ${response.status()} ${await response.text()}`);
    }

    sessionCookies = (await api.storageState()).cookies;
  } finally {
    await api.dispose();
  }

  console.log(`✅ Auth API login successful, cached ${sessionCookies.length} cookies`);
});

Before(async function (this: CustomWorld, { pickle }) {
  await this.init();

  const testId = pickle.tags.find(
    (tag) =>
      tag.name.startsWith('@COMMUNITY-') ||
      tag.name.startsWith('@AGENT-') ||
      tag.name.startsWith('@HOME-') ||
      tag.name.startsWith('@OIDC-') ||
      tag.name.startsWith('@PAGE-') ||
      tag.name.startsWith('@ROUTES-'),
  );
  console.log(`\n📝 Running: ${pickle.name}${testId ? ` (${testId.name.replace('@', '')})` : ''}`);

  // Setup Community API mocks before any page navigation. These PR E2E scenarios
  // are the user-experience baseline for Community UI flows (list/search/filter/
  // detail navigation), not a live marketplace availability check. The live
  // marketplace rate-limits anonymous CI traffic, so Community scenarios use
  // deterministic fixtures while the rest of the E2E suite keeps real app APIs.
  // If we need to validate the real marketplace contract, cover that in a
  // separate integration/nightly suite with dedicated credentials and SLA.
  if (pickle.tags.some((tag) => tag.name === '@community')) {
    await mockManager.setup(this.page);
  }

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
        tag.name.startsWith('@OIDC-') ||
        tag.name.startsWith('@PAGE-') ||
        tag.name.startsWith('@ROUTES-'),
    )
    ?.name.replace('@', '');

  if (result?.status === Status.FAILED && this.page) {
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
  } else if (result?.status === Status.FAILED) {
    console.log(`❌ Failed before page initialization: ${pickle.name}`);
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

  await closeSharedBrowser();

  // Stop web server if we started it
  if (!process.env.BASE_URL && process.env.CI) {
    await stopWebServer();
  }
});
