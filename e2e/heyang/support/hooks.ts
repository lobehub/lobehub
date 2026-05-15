import { After, Before, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium, request } from '@playwright/test';

import type { HeyangWorld } from './world';

setDefaultTimeout(Number(process.env.HEYANG_E2E_STEP_TIMEOUT_MS || 90_000));

Before(async function (this: HeyangWorld) {
  const channel =
    process.env.HEYANG_E2E_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);

  this.browser = await chromium.launch({
    channel,
    headless: process.env.HEADLESS !== 'false',
  });
  this.context = await this.browser.newContext({ baseURL: this.baseURL });
  this.page = await this.context.newPage();
  this.api = await request.newContext({ baseURL: this.baseURL });
});

After(async function (this: HeyangWorld) {
  await this.api?.dispose();
  await this.context?.close();
  await this.browser?.close();
});
