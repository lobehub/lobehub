import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

/**
 * The rail slides 24px on its way in and out. `toBeVisible` resolves the moment
 * visibility flips, well before the transform lands, so any step that toggles
 * the rail must settle it before the next step measures anything.
 */
const settleRail = async (world: CustomWorld) => {
  const rail = world.page.locator('[data-testid="home-rail"]:visible');

  await expect
    .poll(
      async () => {
        const before = await rail.boundingBox();
        await world.page.waitForTimeout(80);
        const after = await rail.boundingBox();
        return before?.x === after?.x;
      },
      { timeout: WAIT_TIMEOUT },
    )
    .toBe(true);
};

Given('用户在受限宽度下打开 Home 页面', async function (this: CustomWorld) {
  // Keep the desktop width while constraining the height so a fresh E2E account's
  // single rail card still overflows and exposes the real ScrollArea scrollbar.
  await this.page.setViewportSize({ height: 360, width: 1500 });
  await this.page.goto('/');

  await expect(this.page.locator('[data-testid="home-rail"]:visible')).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

Then('Home 主列滚动条应位于双列间距中央', async function (this: CustomWorld) {
  const main = this.page.locator('[data-testid="home-main"]:visible');
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const scrollbar = main.locator('[data-orientation="vertical"]').first();

  const [mainBox, railBox, scrollbarBox] = await Promise.all([
    main.boundingBox(),
    rail.boundingBox(),
    scrollbar.boundingBox(),
  ]);

  expect(mainBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(scrollbarBox).not.toBeNull();

  const mainRight = mainBox!.x + mainBox!.width;
  const railLeft = railBox!.x;
  const scrollbarCenter = scrollbarBox!.x + scrollbarBox!.width / 2;
  const columnGapCenter = mainRight + (railLeft - mainRight) / 2;

  expect(scrollbarBox!.x).toBeGreaterThanOrEqual(mainRight);
  expect(scrollbarBox!.x + scrollbarBox!.width).toBeLessThanOrEqual(railLeft);
  expect(scrollbarCenter).toBeCloseTo(columnGapCenter, 0);
});

Then('Home 右栏折叠控制应固定在页面右上角', async function (this: CustomWorld) {
  const main = this.page.locator('[data-testid="home-main"]:visible');
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const toggle = this.page.locator('[data-testid="home-rail-toggle"]:visible');

  await expect(toggle).toBeVisible({ timeout: WAIT_TIMEOUT });

  const [mainBox, expandedBox, viewportWidth] = await Promise.all([
    main.boundingBox(),
    toggle.boundingBox(),
    this.page.evaluate(() => window.innerWidth),
  ]);

  expect(mainBox).not.toBeNull();
  expect(expandedBox).not.toBeNull();
  expect(expandedBox!.y + expandedBox!.height).toBeLessThanOrEqual(mainBox!.y);
  expect(viewportWidth - (expandedBox!.x + expandedBox!.width)).toBeLessThanOrEqual(24);

  await toggle.click();
  await expect(rail).toHaveCount(0);

  const collapsedBox = await toggle.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.x).toBeCloseTo(expandedBox!.x, 0);
  expect(collapsedBox!.y).toBeCloseTo(expandedBox!.y, 0);

  await toggle.click();
  await expect(rail).toBeVisible({ timeout: WAIT_TIMEOUT });
  await settleRail(this);
});

Then('Home 开合右栏不应改变主列纵向位置', async function (this: CustomWorld) {
  const main = this.page.locator('[data-testid="home-main"]:visible');
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const toggle = this.page.locator('[data-testid="home-rail-toggle"]:visible');

  const expandedBox = await main.boundingBox();
  expect(expandedBox).not.toBeNull();

  await toggle.click();
  await expect(rail).toHaveCount(0);

  // Measured mid-collapse on purpose: the greeting wraps against a fixed width,
  // so no frame of the transition may re-wrap it and push the composer plus the
  // whole task list down a line.
  const collapsedBox = await main.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.y).toBeCloseTo(expandedBox!.y, 0);

  await toggle.click();
  await expect(rail).toBeVisible({ timeout: WAIT_TIMEOUT });
  await settleRail(this);
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
