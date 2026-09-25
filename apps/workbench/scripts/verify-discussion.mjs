import assert from 'node:assert/strict';

import { chromium, expect } from '@playwright/test';

const baseUrl = process.argv[2];
assert(baseUrl, 'Usage: node scripts/verify-discussion.mjs <running-workbench-url>');
const acceptanceId = '00000000-0000-4000-8000-000000000001';
const returnPath = `/acceptance/${acceptanceId}?hl=en-US`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/trpc/lambda/acceptance.getBundle?*', (route) =>
    route.fulfill({
      json: {
        result: {
          data: {
            json: {
              acceptance: {
                id: acceptanceId,
                requirement: 'Public discussion regression',
                status: 'accepted',
              },
              author: null,
              canReview: false,
              checks: [],
              flows: [],
              origin: null,
              rounds: [],
              subject: { id: 'discussion-regression', title: 'Public discussion regression' },
            },
          },
        },
      },
    }),
  );
  await page.route('**/trpc/lambda/acceptanceComment.list?*', (route) =>
    route.fulfill({
      json: { result: { data: { json: { canApprove: false, canComment: false, items: [] } } } },
    }),
  );
  await page.goto(new URL(returnPath, baseUrl).href);
  const discussion = page.getByRole('region', { name: 'Discussion', exact: true });
  await expect(discussion).toBeVisible({ timeout: 30_000 });
  for (const route of ['signin', 'signup']) {
    const link = discussion.locator(`a[href^="/${route}?"]`);
    await expect(link).toBeVisible();
    const target = new URL(await link.getAttribute('href'), baseUrl);
    assert.equal(target.searchParams.get('callbackUrl'), returnPath);
  }
  await expect(discussion.getByRole('textbox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(discussion.locator('a[href^="/signin?"]')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: Workbench guest discussion, sign-in/sign-up return URLs, mobile layout');
} finally {
  await browser.close();
}
