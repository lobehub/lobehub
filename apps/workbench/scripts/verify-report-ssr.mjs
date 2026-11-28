import assert from 'node:assert/strict';

import { chromium, expect } from '@playwright/test';

const [baseUrl, acceptanceId] = process.argv.slice(2);
assert(
  baseUrl && acceptanceId,
  'Usage: node scripts/verify-report-ssr.mjs <running-workbench-url> <public-acceptance-id>',
);
const url = new URL(`/acceptance/${encodeURIComponent(acceptanceId)}?hl=en-US`, baseUrl);

const response = await fetch(url);
const html = await response.text();
assert.equal(response.status, 200, 'The report document must render successfully before hydration');
assert(!html.includes('<!--$!-->'), 'The report must not abandon a Suspense boundary during SSR');
assert(html.includes('<h1'), 'The report title must be present without JavaScript');
assert(
  html.includes('aria-label="Acceptance checks"'),
  'The checklist must be present without JavaScript',
);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const navigation = await page.goto(url.href);
    assert.equal(navigation.status(), 200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Acceptance checks', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^All \d+$/ }).click();
    assert.deepEqual(errors, [], `SSR hydration and checklist interaction at ${viewport.width}px`);
    await page.close();
  }
  console.log('PASS: report SSR 200, inline title/checklist, desktop/mobile hydration and filters');
} finally {
  await browser.close();
}
