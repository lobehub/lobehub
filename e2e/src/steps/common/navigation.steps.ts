import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Given Steps (Preconditions)
// ============================================

Given('I navigate to {string}', async function (this: CustomWorld, path: string) {
  const response = await this.page.goto(path, { waitUntil: 'commit' });
  this.testContext.lastResponse = response;
  await this.page.waitForLoadState('domcontentloaded');
});

// ============================================
// Then Steps (Assertions)
// ============================================

Then('the page should load without errors', async function (this: CustomWorld) {
  // Check for no JavaScript errors
  expect(this.testContext.jsErrors).toHaveLength(0);

  // Check page didn't navigate to error page
  const url = this.page.url();
  expect(url).not.toMatch(/\/404|\/error|not-found/i);

  // Check no error title
  const title = await this.page.title();
  expect(title).not.toMatch(/not found|error/i);
});

Then('I should see the page body', async function (this: CustomWorld) {
  const body = this.page.locator('body');
  await expect(body).toBeVisible();
});
