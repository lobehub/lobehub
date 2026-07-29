import { Given, When } from '@cucumber/cucumber';
import { expect, request } from '@playwright/test';

import { TEST_USER } from '../../support/seedTestUser';
import type { CustomWorld } from '../../support/world';

/**
 * Login via UI - fills in the login form and submits
 */
Given('I am logged in as the test user', async function (this: CustomWorld) {
  // Navigate to signin page
  await this.page.goto('/signin');

  // Wait for the login form to be visible
  await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30_000 });

  // Fill in email
  await this.page.fill('input[type="email"], input[name="email"]', TEST_USER.email);

  // Fill in password
  await this.page.fill('input[type="password"], input[name="password"]', TEST_USER.password);

  // Click submit button
  await this.page.click('button[type="submit"]');

  // Wait for navigation away from signin page
  await this.page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 30_000 });

  console.log('✅ Logged in as test user via UI');
});

/**
 * Login via the auth API - faster than UI and uses real better-auth cookies.
 */
Given('I am logged in with a session', async function (this: CustomWorld) {
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3006;
  const baseURL = process.env.BASE_URL || `http://localhost:${PORT}`;
  const api = await request.newContext({ baseURL });

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

    await this.browserContext.addCookies((await api.storageState()).cookies);
  } finally {
    await api.dispose();
  }

  console.log('✅ Session cookies set for test user');
});

/**
 * Navigate to signin page
 */
When('I navigate to the signin page', async function (this: CustomWorld) {
  await this.page.goto('/signin');
  await this.page.waitForLoadState('domcontentloaded');
});

/**
 * Fill in login credentials
 */
When('I enter the test user credentials', async function (this: CustomWorld) {
  await this.page.fill('input[type="email"], input[name="email"]', TEST_USER.email);
  await this.page.fill('input[type="password"], input[name="password"]', TEST_USER.password);
});

/**
 * Submit the login form
 */
When('I submit the login form', async function (this: CustomWorld) {
  await this.page.click('button[type="submit"]');
});

/**
 * Verify login was successful
 */
Given('I should be logged in', async function (this: CustomWorld) {
  // Check we're not on signin page anymore
  await expect(this.page).not.toHaveURL(/\/signin/);

  // Optionally check for user menu or other logged-in indicators
  console.log('✅ User is logged in');
});

/**
 * Logout the current user
 */
When('I logout', async function (this: CustomWorld) {
  // Clear cookies to logout
  await this.browserContext.clearCookies();
  console.log('✅ User logged out (cookies cleared)');
});
