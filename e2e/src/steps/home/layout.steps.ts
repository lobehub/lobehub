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
  // still.
  const columnsScroll = await this.page.evaluate(() =>
    ['home-main', 'home-rail']
      .map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`))
      .filter((node): node is HTMLElement => !!node)
      .some((node) => {
        const overflowY = getComputedStyle(node).overflowY;
        return overflowY === 'auto' || overflowY === 'scroll';
      }),
  );

  expect(columnsScroll).toBe(false);
  // Nor via a scroll-viewport widget nested inside either column.
  await expect(main.locator('[data-orientation="vertical"]')).toHaveCount(0);
  await expect(rail.locator('[data-orientation="vertical"]')).toHaveCount(0);
});

Then('Home 滚动容器应贴合内容区右缘', async function (this: CustomWorld) {
  // NOTE: never declare a named function inside a `page.evaluate` callback here.
  // The steps are transpiled by `tsx/cjs` (esbuild with keepNames), which rewrites
  // `const fn = () => …` into `__name(() => …, 'fn')`. `__name` is a module-scope
  // helper that exists in Node but not in the page, so the callback dies in the
  // browser with `ReferenceError: __name is not defined`. Inline arrows passed
  // straight to `.map` / `.some` are left alone and are safe.
  const measured = await this.page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('[data-testid="home-main"]')!;

    let scroller: HTMLElement | null = null;
    for (let node = main.parentElement; node && !scroller; node = node.parentElement)
      if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) scroller = node;
    if (!scroller) return null;

    // The centred column the dashboard is laid out in — the thing the scroller
    // must NOT be, or the bar floats in the margin beside the content.
    const column = main.parentElement!;

    return {
      columnRight: column.getBoundingClientRect().right,
      overflow: scroller.scrollHeight - scroller.clientHeight,
      paneRight: scroller.parentElement!.getBoundingClientRect().right,
      scrollerRight: scroller.getBoundingClientRect().right,
    };
  });

  expect(measured).not.toBeNull();
  const { columnRight, overflow, paneRight, scrollerRight } = measured!;

  // A scrollbar rides its own scroller's edge, so the scroller has to be the
  // full-width pane, not the centred column inside it.
  expect(overflow).toBeGreaterThan(0);
  expect(scrollerRight).toBeCloseTo(paneRight, 0);
  expect(scrollerRight).toBeGreaterThan(columnRight);
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

  // Wheel deltas are not a positioning API: Chromium can coalesce them, and a
  // preceding kinetic scroll may consume only part of the reverse delta. The
  // following assertions assume the next step starts at the page origin, so
  // reset the actual dashboard scroller deterministically.
  await main.evaluate((node) => {
    for (let current = node.parentElement; current; current = current.parentElement) {
      if (!['auto', 'scroll'].includes(getComputedStyle(current).overflowY)) continue;
      current.scrollTop = 0;
      return;
    }
  });
  await expect
    .poll(
      () =>
        main.evaluate((node) => {
          for (let current = node.parentElement; current; current = current.parentElement)
            if (['auto', 'scroll'].includes(getComputedStyle(current).overflowY))
              return current.scrollTop;
          return 0;
        }),
      { timeout: WAIT_TIMEOUT },
    )
    .toBe(0);
  await settleBox(this, main);
});

Then('Home 右栏应保持卡片与页面边缘的分层间距', async function (this: CustomWorld) {
  const rail = this.page.locator('[data-testid="home-rail"]:visible');
  const card = rail.getByTestId('home-rail-card').first();

  await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });

  const [railBox, cardBox, viewportWidth] = await Promise.all([
    rail.boundingBox(),
    card.boundingBox(),
    this.page.evaluate(() => window.innerWidth),
  ]);

  expect(railBox).not.toBeNull();
  expect(cardBox).not.toBeNull();

  const railRight = railBox!.x + railBox!.width;
  const cardRight = cardBox!.x + cardBox!.width;

  // Card → gutter → column edge → page margin, each layer clear of the last.
  expect(cardBox!.width).toBeCloseTo(380, 0);
  expect(railRight - cardRight).toBeCloseTo(14, 0);
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
