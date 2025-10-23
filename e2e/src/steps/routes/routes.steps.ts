import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Given Steps (Preconditions)
// ============================================

Given('the application is running', async function (this: CustomWorld) {
  // This is a placeholder step to indicate that the app should be running
  // The actual server startup is handled outside the test (in CI or locally)
  // We just verify we can reach the base URL
  const response = await this.page.goto('/');
  expect(response).toBeTruthy();
  // Store the response for later assertions
  this.testContext.lastResponse = response;
});

// ============================================
// Then Steps (Assertions)
// ============================================

Then(
  'the response status should be less than {int}',
  async function (this: CustomWorld, maxStatus: number) {
    const status = this.testContext.lastResponse?.status() ?? 0;
    expect(status, `Expected status < ${maxStatus}, but got ${status}`).toBeLessThan(maxStatus);
  },
);

Then(
  'the page title should not contain {string} or {string}',
  async function (this: CustomWorld, text1: string, text2: string) {
    const title = await this.page.title();
    const regex = new RegExp(`${text1}|${text2}`, 'i');
    expect(title, `Page title "${title}" should not contain "${text1}" or "${text2}"`).not.toMatch(
      regex,
    );
  },
);
