import { Given, Then } from '@cucumber/cucumber';
import { expect, type Locator } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

/**
 * Wait until a node stops moving. Both the rail transition (24px slide) and a
 * wheel-driven scroll resolve their promise well before the motion lands, so
 * any step that measures after one must settle it first.
 */
const settleBox = async (world: CustomWorld, target: Locator) => {
  await expect
    .poll(
      async () => {
        const before = await target.boundingBox();
        await world.page.waitForTimeout(80);
        const after = await target.boundingBox();
        return before?.x === after?.x && before?.y === after?.y;
      },
      { timeout: WAIT_TIMEOUT },
    )
    .toBe(true);
};

const settleRail = (world: CustomWorld) =>
  settleBox(world, world.page.locator('[data-testid="home-rail"]:visible'));

Given('用户在受限宽度下打开 Home 页面', async function (this: CustomWorld) {
  // Keep the desktop width while constraining the height so a fresh E2E account's
  // single rail card still overflows and exposes the real ScrollArea scrollbar.
  await this.page.setViewportSize({ height: 360, width: 1500 });
  await this.page.goto('/');

  await expect(this.page.locator('[data-testid="home-rail"]:visible')).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

Then('Home 主列与右栏都不应有各自的滚动条', async function (this: CustomWorld) {
  const main = this.page.locator('[data-testid="home-main"]:visible');
  const rail = this.page.locator('[data-testid="home-rail"]:visible');

  // A column-local viewport is exactly what "scroll as one page" rules out: it
  // would let the topic list travel under a pinned greeting while the rail sits
  // still. The page scroller is the only vertical scrollbar on the dashboard.
  await expect(main.locator('[data-orientation="vertical"]')).toHaveCount(0);
  await expect(rail.locator('[data-orientation="vertical"]')).toHaveCount(0);
  await expect(
    this.page
      .locator('[data-testid="home-scroll"]:visible')
      .locator('[data-orientation="vertical"]'),
  ).toHaveCount(1);
});

Then('Home 滚动应同时带动主列与右栏', async function (this: CustomWorld) {
  const main = this.page.locator('[data-testid="home-main"]:visible');
  const rail = this.page.locator('[data-testid="home-rail"]:visible');

  const [mainBefore, railBefore] = await Promise.all([main.boundingBox(), rail.boundingBox()]);
  expect(mainBefore).not.toBeNull();
  expect(railBefore).not.toBeNull();

  // Wheel over the main column, not the rail: the point is that a gesture
  // anywhere in the dashboard moves the whole dashboard.
  await main.hover({ position: { x: 40, y: 40 } });
  await this.page.mouse.wheel(0, 200);
  await settleBox(this, main);

  const [mainAfter, railAfter] = await Promise.all([main.boundingBox(), rail.boundingBox()]);
  const mainShift = mainBefore!.y - mainAfter!.y;

  // The Given constrains the viewport height so the dashboard genuinely
  // overflows; without this the equality below would hold vacuously at 0.
  expect(mainShift).toBeGreaterThan(0);
  expect(railBefore!.y - railAfter!.y).toBeCloseTo(mainShift, 0);

  await this.page.mouse.wheel(0, -200);
  await settleBox(this, main);
});

Then('Home 页面滚动条应位于右栏卡片与页面边缘之间', async function (this: CustomWorld) {
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const card = rail.getByTestId('home-rail-card').first();
  const scrollbar = this.page
    .locator('[data-testid="home-scroll"]:visible')
    .locator('[data-orientation="vertical"]')
    .first();

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

  // Card → gutter → scrollbar track → page edge, each layer clear of the last.
  expect(cardBox!.width).toBeCloseTo(380, 0);
  expect(railRight - cardRight).toBeCloseTo(14, 0);
  expect(scrollbarBox!.x).toBeGreaterThanOrEqual(cardRight);
  expect(viewportWidth - railRight).toBeGreaterThanOrEqual(24);
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
