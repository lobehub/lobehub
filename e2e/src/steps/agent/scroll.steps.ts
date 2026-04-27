/**
 * Agent Scroll Steps
 *
 * Step definitions for @AGENT-SCROLL-* scenarios. These verify that the
 * `useConversationScroll` hook + `<AutoScroll />` component cooperate
 * correctly under the three real-world cases:
 *
 * 1. `enableAutoScrollOnStreaming = true`   → viewport stays near bottom
 * 2. `enableAutoScrollOnStreaming = false`  → user message pinned to top
 * 3. User scrolls up mid-stream              → viewport stays put
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { llmMockManager, presetResponses } from '../../mocks/llm';
import type { CustomWorld } from '../../support/world';

// How close to the scroll container's bottom is considered "at bottom".
// Matches (with slack) the product's own AT_BOTTOM_THRESHOLD (300 px).
const AT_BOTTOM_EPSILON = 320;
// Distance the user manually scrolls up for scenario 3.
const MANUAL_SCROLL_UP_DELTA = 200;

interface ScrollSnapshot {
  clientHeight: number;
  distanceToBottom: number;
  scrollHeight: number;
  scrollTop: number;
}

// ---------------------------------------------------------------------------
// DOM helpers (executed inside the page)
// ---------------------------------------------------------------------------

// Find the scrollable ancestor of the first `.message-wrapper`. This is the
// virtua VList's inner scroll container — product code doesn't add a stable
// data-testid to it, but the structure is reliable enough for an e2e test.
async function getScrollSnapshot(world: CustomWorld): Promise<ScrollSnapshot | null> {
  return world.page.evaluate(() => {
    const msg = document.querySelector('.message-wrapper');
    let el: HTMLElement | null = (msg?.parentElement as HTMLElement) || null;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return {
          clientHeight: el.clientHeight,
          distanceToBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
        };
      }
      el = el.parentElement;
    }
    return null;
  });
}

async function scrollBy(world: CustomWorld, deltaY: number): Promise<void> {
  await world.page.evaluate((dy) => {
    const msg = document.querySelector('.message-wrapper');
    let el: HTMLElement | null = (msg?.parentElement as HTMLElement) || null;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        el.scrollTop = Math.max(0, el.scrollTop + dy);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
      el = el.parentElement;
    }
  }, deltaY);
}

// ---------------------------------------------------------------------------
// Setting toggle via the chat-appearance settings page
// ---------------------------------------------------------------------------

async function setAutoScrollEnabled(world: CustomWorld, desired: boolean): Promise<void> {
  await world.page.goto('/settings/chat-appearance');
  // `networkidle` can take a while on the very first compile in dev mode
  // (Next.js builds the settings route on demand); a generous timeout avoids
  // flakes when the test suite warms up a cold server.
  await world.page.waitForLoadState('networkidle', { timeout: 60_000 });

  // Match both EN ("Auto-scroll During AI Response") and zh-CN ("AI 回复时自动滚动").
  const title = world.page.getByText(/Auto-scroll During AI Response|AI 回复时自动滚动/);
  await expect(title).toBeVisible({ timeout: 45_000 });

  // The switch lives inside the same FormGroup as the title.
  const switcher = world.page
    .locator('[role="switch"], button.ant-switch')
    .filter({
      has: title,
    })
    .or(
      world.page
        .locator('div')
        .filter({ has: title })
        .last()
        .locator('[role="switch"], button.ant-switch')
        .first(),
    );

  // Fall back: the switch is the nearest role=switch sibling of the title node.
  const nearestSwitch = world.page.locator('[role="switch"]').first();
  const target = (await switcher.count()) > 0 ? switcher.first() : nearestSwitch;

  const currentChecked = (await target.getAttribute('aria-checked')) === 'true';
  if (currentChecked !== desired) {
    await target.click();
    // Give the optimistic update + debounced server call a moment to settle.
    await world.page.waitForTimeout(400);
  }
}

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given(
  '用户在设置中开启 {string}',
  { timeout: 90_000 },
  async function (this: CustomWorld, _label: string) {
    await setAutoScrollEnabled(this, true);
  },
);

Given(
  '用户在设置中关闭 {string}',
  { timeout: 90_000 },
  async function (this: CustomWorld, _label: string) {
    await setAutoScrollEnabled(this, false);
  },
);

Given('流式响应被放慢以模拟长文输出', async function (this: CustomWorld) {
  // A ~1.5s head-delay gives the test room to interact (manual scroll) while
  // the assistant placeholder is mounted but no tokens have streamed yet.
  llmMockManager.setConfig({ responseDelay: 1500, streamChunkSize: 8, streamDelay: 60 });
  this.testContext.scrollMockAdjusted = true;
});

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('用户发送长文消息并等待回复完成', { timeout: 45_000 }, async function (this: CustomWorld) {
  const prompt = '请输出一篇很长的文章';
  llmMockManager.setResponse(prompt, presetResponses.longScrollArticle);

  await this.page.keyboard.type(prompt, { delay: 20 });
  await this.page.waitForTimeout(200);
  await this.page.keyboard.press('Enter');

  // Wait for assistant message to appear and its content to stabilize.
  const messageWrappers = this.page.locator('.message-wrapper');
  await expect(messageWrappers)
    .toHaveCount(2, { timeout: 15_000 })
    .catch(() => {});

  const assistantMessage = this.page
    .locator('.message-wrapper')
    .filter({ has: this.page.locator('text=Lobe AI') })
    .last();
  await expect(assistantMessage).toBeVisible({ timeout: 15_000 });

  // Poll until text has grown past an obvious threshold, then plateaus.
  let prevLen = 0;
  let stableTicks = 0;
  for (let i = 0; i < 40; i++) {
    const len =
      (await assistantMessage
        .innerText()
        .then((t) => t.length)
        .catch(() => 0)) || 0;
    if (len > 200 && len === prevLen) stableTicks += 1;
    else stableTicks = 0;
    prevLen = len;
    if (stableTicks >= 3) break;
    await this.page.waitForTimeout(250);
  }
});

When('用户发送一条触发长文输出的消息', async function (this: CustomWorld) {
  const prompt = '请输出一篇很长的文章';
  llmMockManager.setResponse(prompt, presetResponses.longScrollArticle);

  await this.page.keyboard.type(prompt, { delay: 20 });
  await this.page.waitForTimeout(200);
  await this.page.keyboard.press('Enter');

  // Wait long enough for pin's smooth scrollToIndex to finish. Virtua drives
  // the smooth animation via rAF and would otherwise overwrite a manual
  // scroll while the animation is still in flight.
  await this.page.waitForTimeout(1200);
});

When('用户在流式响应进行中向上滚动 {int} 像素', async function (this: CustomWorld, px: number) {
  const delta = Math.abs(px) || MANUAL_SCROLL_UP_DELTA;
  // Mouse wheel over the list, more faithful to real-user interaction than
  // setting `scrollTop` directly. Move the cursor into the list viewport
  // first — wheel events fire against whatever element is under the cursor.
  await this.page.mouse.move(640, 400);
  await this.page.mouse.wheel(0, -delta);
  await scrollBy(this, -delta);
  // Let the onScroll handler run (pin cancel + spacer shrink).
  await this.page.waitForTimeout(400);
});

When('等待流式响应结束', { timeout: 30_000 }, async function (this: CustomWorld) {
  const assistantMessage = this.page
    .locator('.message-wrapper')
    .filter({ has: this.page.locator('text=Lobe AI') })
    .last();

  let prevLen = 0;
  let stableTicks = 0;
  for (let i = 0; i < 60; i++) {
    const len =
      (await assistantMessage
        .innerText()
        .then((t) => t.length)
        .catch(() => 0)) || 0;
    if (len > 200 && len === prevLen) stableTicks += 1;
    else stableTicks = 0;
    prevLen = len;
    if (stableTicks >= 3) break;
    await this.page.waitForTimeout(250);
  }
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

Then('视口应贴近聊天列表底部', async function (this: CustomWorld) {
  const snap = await getScrollSnapshot(this);
  expect(snap, 'failed to locate scroll container').not.toBeNull();
  expect(snap!.distanceToBottom).toBeLessThanOrEqual(AT_BOTTOM_EPSILON);
});

Then('视口不应贴近聊天列表底部', async function (this: CustomWorld) {
  const snap = await getScrollSnapshot(this);
  expect(snap, 'failed to locate scroll container').not.toBeNull();
  expect(snap!.distanceToBottom).toBeGreaterThan(AT_BOTTOM_EPSILON);
});

// Reset LLM mock timing overrides so the slowdown from scenario 3 does not
// leak into later unrelated scenarios.
After({ tags: '@scroll' }, async function (this: CustomWorld) {
  if (this.testContext.scrollMockAdjusted) {
    llmMockManager.resetConfig();
    this.testContext.scrollMockAdjusted = false;
  }
});

Then('用户消息不应固定在聊天列表顶部', async function (this: CustomWorld) {
  const rect = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.message-wrapper'));
    if (wrappers.length < 2) return null;
    const userWrapper = wrappers.at(-2) as HTMLElement;
    let scrollParent: HTMLElement | null = userWrapper.parentElement;
    while (scrollParent) {
      const style = window.getComputedStyle(scrollParent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return null;
    const wrapperRect = userWrapper.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    return { delta: wrapperRect.top - parentRect.top };
  });

  expect(rect).not.toBeNull();
  // Pin is cancelled: the user message should have been pushed down by the
  // manual scroll. Anything beyond the "pinned" slack (150 px) means the
  // anchor was released.
  expect(Math.abs(rect!.delta)).toBeGreaterThan(150);
});

Then('用户消息应固定在聊天列表顶部', async function (this: CustomWorld) {
  // Find the user message (the penultimate `.message-wrapper`) and check its
  // top is close to the scroll container top. We allow some slack because
  // virtua lays out with some padding and the header can stick.
  const rect = await this.page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.message-wrapper'));
    if (wrappers.length < 2) return null;
    const userWrapper = wrappers.at(-2) as HTMLElement;
    let scrollParent: HTMLElement | null = userWrapper.parentElement;
    while (scrollParent) {
      const style = window.getComputedStyle(scrollParent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return null;
    const wrapperRect = userWrapper.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    return {
      parentTop: parentRect.top,
      userTop: wrapperRect.top,
      delta: wrapperRect.top - parentRect.top,
    };
  });

  expect(rect, 'failed to resolve user message + scroll parent').not.toBeNull();
  // Pin anchors with `align: 'start'` — tolerate ~150 px of slack for headers.
  expect(Math.abs(rect!.delta)).toBeLessThanOrEqual(150);
});
