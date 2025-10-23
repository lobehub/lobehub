import { After, AfterAll, Before, BeforeAll, Status, setDefaultTimeout } from '@cucumber/cucumber';

import { startWebServer, stopWebServer } from '../support/webServer';
import { CustomWorld } from '../support/world';

// Set default timeout for all steps to 120 seconds
setDefaultTimeout(120_000);

BeforeAll({ timeout: 120_000 }, async function () {
  console.log('🚀 Starting E2E test suite...');

  const PORT = process.env.PORT ? Number(process.env.PORT) : 3010;
  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

  console.log(`Base URL: ${BASE_URL}`);

  // Start web server if not using external BASE_URL
  if (!process.env.BASE_URL) {
    await startWebServer({
      command: 'npm run dev',
      port: PORT,
      reuseExistingServer: !process.env.CI,
    });
  }
});

Before(async function (this: CustomWorld, { pickle }) {
  await this.init();

  const testId = pickle.tags.find((tag) => tag.name.startsWith('@DISCOVER-'));
  console.log(`\n📝 Running: ${pickle.name}${testId ? ` (${testId.name.replace('@', '')})` : ''}`);
});

After(async function (this: CustomWorld, { pickle, result }) {
  const testId = pickle.tags
    .find((tag) => tag.name.startsWith('@DISCOVER-'))
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
