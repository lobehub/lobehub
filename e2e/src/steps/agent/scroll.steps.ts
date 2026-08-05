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
  bottomCompensationHeight: number;
  clientHeight: number;
  distanceToBottom: number;
  scrollHeight: number;
  scrollTop: number;
}

// ---------------------------------------------------------------------------
// DOM helpers (executed inside the page)
// ---------------------------------------------------------------------------

// The chat list's scroll viewport is virtua's own root element and carries no
// test id, so every helper below resolves it the way the DOM exposes it: the
// nearest scrollable ancestor of a mounted message.
async function getScrollSnapshot(world: CustomWorld): Promise<ScrollSnapshot | null> {
  const anyMessage = world.page.locator('.message-wrapper').first();
  if ((await anyMessage.count()) === 0) return null;

  return anyMessage.evaluate((node) => {
    let el: HTMLElement | null = node.parentElement;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      el = el.parentElement;
    }
    if (!el) return null;

    const bottomCompensationHeight = Math.max(
      0,
      ...Array.from(el.querySelectorAll<HTMLElement>('div[aria-hidden="true"]'))
        .filter((candidate) => {
          const nodeStyle = window.getComputedStyle(candidate);
          return nodeStyle.pointerEvents === 'none' && candidate.offsetWidth > 0;
        })
        .map((candidate) => candidate.getBoundingClientRect().height),
    );

    return {
      bottomCompensationHeight,
      clientHeight: el.clientHeight,
      distanceToBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
  });
}

async function sendPrompt(world: CustomWorld, prompt: string, response: string): Promise<void> {
  llmMockManager.setResponse(prompt, response);

  const existingMessageIds = new Set(
    await world.page
      .locator('.message-wrapper')
      .evaluateAll((messages) =>
        messages.flatMap((message) => message.getAttribute('data-message-id') || []),
      ),
  );

  const input = world.page
    .locator(
      '[data-testid="chat-input"] [contenteditable="true"], [data-testid="chat-input"] textarea',
    )
    .filter({ visible: true })
    .first();
  await expect(input, `chat input is not available before sending: ${prompt}`).toBeVisible();
  await expect(input, `chat input is not editable before sending: ${prompt}`).toBeEditable();
  // Click to focus rather than relying on ambient focus (the previous send may
  // have left it anywhere), then type for real: `fill()` writes straight to the
  // DOM, which the Lexical editor does not pick up as editor state, so Enter
  // would submit an empty message.
  await input.click();
  await world.page.keyboard.type(prompt, { delay: 20 });
  await expect(input, `chat input did not receive prompt text: ${prompt}`).toContainText(prompt);
  await world.page.keyboard.press('Enter');

  const sentMessage = world.page.locator('.message-wrapper').filter({ hasText: prompt });
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const matchingIds = await sentMessage.evaluateAll((messages) =>
          messages.flatMap((message) => message.getAttribute('data-message-id') || []),
        );
        // The optimistic message renders under a `tmp_` id and is re-keyed to the
        // persisted id a moment later. Anchoring the assertion to the temp id
        // would leave it pointing at a node that no longer exists, which reads as
        // "the pin never landed" no matter where the viewport actually is.
        messageId = matchingIds.find((id) => !existingMessageIds.has(id) && !id.startsWith('tmp_'));
        return messageId;
      },
      {
        message: `user message was not persisted after sending prompt: ${prompt}`,
        timeout: 15_000,
      },
    )
    .toBeTruthy();

  world.testContext.lastSentUserMessageId = messageId;
}

async function waitForAssistantMessageToSettle(
  world: CustomWorld,
  minLength: number,
): Promise<void> {
  const assistantMessage = world.page
    .locator('.message-wrapper')
    .filter({ has: world.page.locator('text=Lobe AI') })
    .last();

  await expect(assistantMessage).toBeVisible({ timeout: 15_000 });

  // Settle on the rendered reply itself: its length has to clear `minLength` and
  // then hold steady for a few ticks. Bailing out early would let the next send
  // land while the run is still active, where it gets queued instead of appended.
  const deadline = Date.now() + 45_000;
  let previousLength = 0;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    const length = await assistantMessage
      .innerText()
      .then((text) => text.length)
      .catch(() => 0);

    stableTicks = length > minLength && length === previousLength ? stableTicks + 1 : 0;
    previousLength = length;
    if (stableTicks >= 3) return;

    await world.page.waitForTimeout(250);
  }

  throw new Error(`assistant response did not settle in time (last length: ${previousLength})`);
}

async function scrollBy(world: CustomWorld, deltaY: number): Promise<void> {
  await world.page
    .locator('.message-wrapper')
    .first()
    .evaluate((node, dy) => {
      let el: HTMLElement | null = node.parentElement;
      while (el) {
        const { overflowY } = window.getComputedStyle(el);
        if (overflowY === 'auto' || overflowY === 'scroll') {
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
  // The first local dev compile can take a while, so keep an explicit timeout.
  // (Next.js builds the settings route on demand); a generous timeout avoids
  // flakes when the test suite warms up a cold server.
  await world.page.waitForLoadState('domcontentloaded', { timeout: 60_000 });

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
    await expect(target).toHaveAttribute('aria-checked', String(desired));

    // Navigating while the async settings request is still in flight can
    // abort it and make the next page reload the previous value. Wait for the
    // UI's save-state contract instead of relying on a fixed delay.
    await expect(world.page.getByText(/Saved|\u5DF2\u4FDD\u5B58/).last()).toBeVisible({
      timeout: 15_000,
    });
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
  // The pin is only observable while the reply is short enough that the spacer
  // still holds the user message at the top; once the reply outgrows the
  // viewport the spacer collapses and auto-scroll (on by default) takes over.
  // So the stable window to assert against is the *head delay*, where the
  // assistant placeholder is mounted but no tokens have streamed yet. Make that
  // window generous and keep the stream itself brisk — a slow per-chunk stream
  // would push a full turn past `等待流式响应结束`'s timeout on a loaded CI box.
  llmMockManager.setConfig({ responseDelay: 4000, streamChunkSize: 40, streamDelay: 25 });
  this.testContext.scrollMockAdjusted = true;
});

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('用户发送长文消息并等待回复完成', { timeout: 45_000 }, async function (this: CustomWorld) {
  const prompt = '请输出一篇很长的文章';
  await sendPrompt(this, prompt, presetResponses.longScrollArticle);

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
  await waitForAssistantMessageToSettle(this, 200);
});

When('用户发送一条触发长文输出的消息', async function (this: CustomWorld) {
  const prompt = '请输出一篇很长的文章';
  await sendPrompt(this, prompt, presetResponses.longScrollArticle);

  // Wait long enough for pin's smooth scrollToIndex to finish. Virtua drives
  // the smooth animation via rAF and would otherwise overwrite a manual
  // scroll while the animation is still in flight.
  await this.page.waitForTimeout(1200);
});

When(
  '用户完成一轮用于垫高列表的长回复对话',
  { timeout: 45_000 },
  async function (this: CustomWorld) {
    const prompt = '请先输出一篇很长的文章用于垫高列表';
    await sendPrompt(this, prompt, presetResponses.longScrollArticle);
    await waitForAssistantMessageToSettle(this, 200);
  },
);

When(
  '用户发送一条触发短回复的消息并等待回复完成',
  { timeout: 30_000 },
  async function (this: CustomWorld) {
    const prompt = '请输出一段短回复用于测试底部补偿区域';
    await sendPrompt(this, prompt, '这是一个短回复，用于让底部补偿区域保持可见。');
    await waitForAssistantMessageToSettle(this, 10);
    await this.page.waitForTimeout(400);
  },
);

When('记录聊天列表底部补偿区域高度', async function (this: CustomWorld) {
  const snap = await getScrollSnapshot(this);
  expect(snap, 'failed to locate scroll container').not.toBeNull();
  expect(snap!.bottomCompensationHeight).toBeGreaterThan(0);
  expect(snap!.scrollTop).toBeGreaterThan(120);

  this.testContext.scrollCompensationHeight = snap!.bottomCompensationHeight;
  this.testContext.scrollHeightBeforeSyntheticOffset = snap!.scrollHeight;
});

When('模拟非用户触发的聊天列表上移 {int} 像素', async function (this: CustomWorld, px: number) {
  await scrollBy(this, -Math.abs(px));
  await this.page.waitForTimeout(400);
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

When('等待流式响应结束', { timeout: 60_000 }, async function (this: CustomWorld) {
  await waitForAssistantMessageToSettle(this, 200);
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
  const rect = await measurePinDelta(this);

  expect(rect).not.toBeNull();
  // Pin is cancelled: the user message should have been pushed down by the
  // manual scroll. Anything beyond the "pinned" slack (150 px) means the
  // anchor was released.
  expect(Math.abs(rect!.delta)).toBeGreaterThan(150);
});

async function measurePinDelta(world: CustomWorld) {
  const messageId = world.testContext.lastSentUserMessageId as string | undefined;
  expect(messageId, 'missing the latest sent user message id').toBeDefined();

  const userMessage = world.page.locator(`.message-wrapper[data-message-id="${messageId}"]`);
  await expect(userMessage, `latest user message ${messageId} is not mounted`).toBeVisible();

  return userMessage.evaluate((message) => {
    let el: HTMLElement | null = message.parentElement;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      el = el.parentElement;
    }
    if (!el) return null;

    const wrapperRect = message.getBoundingClientRect();
    const parentRect = el.getBoundingClientRect();
    return {
      delta: wrapperRect.top - parentRect.top,
      parentTop: parentRect.top,
      userTop: wrapperRect.top,
    };
  });
}

Then('用户消息应固定在聊天列表顶部', async function (this: CustomWorld) {
  // The pin uses a smooth (`align:'start', smooth:true`) scroll that re-fires on
  // every layout bump while the reply streams — so the anchored position is
  // reached *repeatedly*, not at one fixed instant. Sampling once after a fixed
  // wait races that animation and flakes (a mid-animation frame reads ~260px).
  // Poll for a settled frame within the slack instead. If the pin genuinely
  // never lands, the loop exhausts and the final assertion still fails with the
  // real delta — so a true regression is not masked.
  const PIN_SLACK = 150;
  await expect
    .poll(
      async () => {
        const rect = await measurePinDelta(this);
        return rect ? Math.abs(rect.delta) : null;
      },
      {
        message: 'latest user message did not reach the pinned position',
        timeout: 5000,
      },
    )
    .toBeLessThanOrEqual(PIN_SLACK);
});

Then('聊天列表底部补偿区域高度不应收缩', async function (this: CustomWorld) {
  const before = this.testContext.scrollCompensationHeight as number | undefined;
  expect(before, 'missing recorded bottom compensation height').toBeDefined();

  const snap = await getScrollSnapshot(this);
  expect(snap, 'failed to locate scroll container').not.toBeNull();

  expect(snap!.bottomCompensationHeight).toBeGreaterThanOrEqual(before! - 2);
});
