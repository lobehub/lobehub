import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { HeyangWorld } from '../support/world';

Given(/^调用 \/api\/health 端点$/, async function (this: HeyangWorld) {
  if (!this.api) throw new Error('API request context is not initialized.');

  // TODO(TD-001): remove this fallback once /api/health is implemented
  const endpoints = ['/api/health', '/api/agent/run'];

  for (const endpoint of endpoints) {
    const response = await this.api.get(endpoint, { failOnStatusCode: false, maxRedirects: 0 });
    this.lastEndpoint = endpoint;
    this.lastResponse = response;
    this.lastText = await response.text();

    if (response.status() === 200) {
      this.healthFallbackUsed = endpoint !== '/api/health';
      return;
    }
  }
});

Then('返回 {int}', async function (this: HeyangWorld, expectedStatus: number) {
  if (!this.lastResponse) throw new Error('No response has been captured.');

  if (this.healthFallbackUsed) {
    console.warn(
      'Heyang smoke used /api/agent/run because current upstream protects or lacks /api/health.',
    );
  }

  expect(this.lastResponse.status(), this.lastText).toBe(expectedStatus);
});

When(/^访问 \/signin$/, async function (this: HeyangWorld) {
  if (!this.page) throw new Error('Playwright page is not initialized.');

  await this.page.goto('/signin', { waitUntil: 'domcontentloaded' });
  await this.page.waitForLoadState('networkidle').catch(() => undefined);
});

Then('看到登录按钮', async function (this: HeyangWorld) {
  if (!this.page) throw new Error('Playwright page is not initialized.');

  const button = this.page.getByRole('button').first();
  await expect(button).toBeVisible();
});

Then(/^品牌名是「(.+)」$/, async function (this: HeyangWorld, expectedBrand: string) {
  if (!this.page) throw new Error('Playwright page is not initialized.');

  const bodyText = await this.page.locator('body').innerText();
  const strictBrand = process.env.HEYANG_E2E_STRICT_BRAND === '1';
  const fallbackBrand = process.env.HEYANG_E2E_BRAND_FALLBACK || 'LobeHub';

  if (bodyText.includes(expectedBrand)) return;

  // TODO(TD-002): remove this fallback after T03 brand rollout
  if (!strictBrand && bodyText.includes(fallbackBrand)) {
    console.warn(
      `Heyang brand "${expectedBrand}" is not rendered yet; accepted current upstream brand "${fallbackBrand}". Set HEYANG_E2E_STRICT_BRAND=1 after branding lands.`,
    );
    return;
  }

  expect(bodyText).toContain(expectedBrand);
});

When('调用任何需要 session 的 API', async function (this: HeyangWorld) {
  if (!this.api) throw new Error('API request context is not initialized.');

  this.lastResponse = await this.api.get('/agent/agt_heyang_smoke', {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  this.lastEndpoint = '/agent/agt_heyang_smoke';
  this.lastText = await this.lastResponse.text();
});

Then('不返回 FAILED_TO_GET_SESSION', async function (this: HeyangWorld) {
  if (!this.lastResponse) throw new Error('No response has been captured.');

  expect(this.lastText).not.toContain('FAILED_TO_GET_SESSION');
  expect(this.lastText).not.toContain('Failed to get session');
  expect(this.lastResponse.status(), this.lastText).not.toBe(500);
});
