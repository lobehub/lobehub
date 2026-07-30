import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

Given('用户在受限宽度下打开 Home 页面', async function (this: CustomWorld) {
  // Keep the desktop width while constraining the height so a fresh E2E account's
  // single rail card still overflows and exposes the real ScrollArea scrollbar.
  await this.page.setViewportSize({ height: 360, width: 1500 });
  await this.page.goto('/');

  await expect(this.page.locator('[data-testid="home-rail"]:visible')).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

Then('Home 右栏应保持卡片、滚动条轨道与页面边缘的分层间距', async function (this: CustomWorld) {
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const card = rail.getByTestId('home-rail-card').first();
  const scrollbar = rail.locator('[data-orientation="vertical"]').first();

  await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });

  const [railBox, cardBox, scrollbarBox, viewportWidth] = await Promise.all([
    rail.boundingBox(),
    card.boundingBox(),
    scrollbar.boundingBox(),
    this.page.evaluate(() => window.innerWidth),
  ]);

  expect(railBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(scrollbarBox).not.toBeNull();

  const railRight = railBox!.x + railBox!.width;
  const cardRight = cardBox!.x + cardBox!.width;
  const scrollbarRight = scrollbarBox!.x + scrollbarBox!.width;

  expect(cardBox!.width).toBeCloseTo(380, 0);
  expect(railRight - cardRight).toBeCloseTo(14, 0);
  expect(scrollbarBox!.x).toBeGreaterThanOrEqual(cardRight);
  expect(scrollbarRight).toBeLessThanOrEqual(railRight);
  expect(viewportWidth - railRight).toBeGreaterThanOrEqual(24);
});
