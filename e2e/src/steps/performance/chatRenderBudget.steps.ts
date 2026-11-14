/**
 * Render-budget scenarios for opening and switching chats. They need a server
 * built with `LOBE_REACT_PROFILING=1` and run only under `E2E_PERF=1`; see
 * `e2e/src/features/performance/chat-render-budget.feature`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { After, Given, Then, When } from '@cucumber/cucumber';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import {
  type ChatFixture,
  removeChatFixture,
  seedChatFixture,
} from '../../performance/chatFixture';
import { CHAT_RENDER_BUDGETS } from '../../performance/chatRenderBudgets';
import {
  type ChatRenderScenario,
  findBudgetViolations,
  resolveRunnerKind,
  summarizeReports,
} from '../../performance/renderBudget';
import {
  assertProfilingBuild,
  beginProfile,
  endProfileWhenSettled,
  type RenderReport,
} from '../../performance/renderProfile';
import type { CustomWorld } from '../../support/world';

const OPEN_ITERATIONS = 5;
const CACHED_SWITCHES = 9;
const UNCACHED_SWITCHES = 5;
const COLD_SWITCHES = 3;
const LOOP_TIMEOUT = 240_000;

const RECEIPT_DIR = path.join(process.cwd(), 'reports', 'render-budget');

interface PerfContext {
  fixture: ChatFixture;
  reports: Partial<Record<ChatRenderScenario, RenderReport[]>>;
}

const perf = (world: CustomWorld): PerfContext => world.testContext.perf;

const topicUrl = (fixture: ChatFixture, index: number) =>
  `/agent/${fixture.agentId}/${fixture.topicIds[index]}`;

const waitForTranscript = (page: Page, fixture: ChatFixture, index: number) =>
  expect(page.getByText(fixture.markers[index]).first()).toBeVisible({ timeout: 30_000 });

/**
 * Loads a topic in a new document and returns the `boot` scenario the
 * profiling build started before the first commit.
 */
const openChat = async (page: Page, fixture: ChatFixture, index: number) => {
  await page.goto(topicUrl(fixture, index), { waitUntil: 'domcontentloaded' });
  await waitForTranscript(page, fixture, index);
  await assertProfilingBuild(page);
  return endProfileWhenSettled(page);
};

const switchTopic = async (page: Page, fixture: ChatFixture, index: number) => {
  const item = page.locator(
    `[data-testid="topic-item"][data-topic-id="${fixture.topicIds[index]}"]`,
  );
  await expect(item).toBeVisible();
  // Park the pointer on the empty composer area so hover cards stay closed.
  await page.mouse.move(900, 650);

  await beginProfile(page, `switch:${index}`);
  await item.click();
  await waitForTranscript(page, fixture, index);
  return endProfileWhenSettled(page);
};

const record = (world: CustomWorld, scenario: ChatRenderScenario, report: RenderReport) => {
  const reports = (perf(world).reports[scenario] ??= []);
  reports.push(report);
  console.log(
    `   📏 ${scenario} #${reports.length}: ` +
      Object.entries(report.regions)
        .map(([region, r]) => `${region} ${r.renders}× ${r.actualDurationMs}ms`)
        .join(', ') +
      `, max frame gap ${report.frames.maxGapMs}ms`,
  );
};

// ============================================
// Given
// ============================================

Given('用户有一个带多个历史话题的 Agent', async function (this: CustomWorld) {
  this.testContext.perf = { fixture: await seedChatFixture(), reports: {} } satisfies PerfContext;
});

// ============================================
// When
// ============================================

When(
  '用户多次打开该 Agent 的 chat 页面',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld) {
    const { fixture } = perf(this);

    // The first load fills the HTTP cache; `open` measures a returning user.
    await openChat(this.page, fixture, 0);

    for (let i = 0; i < OPEN_ITERATIONS; i += 1) {
      record(this, 'open', await openChat(this.page, fixture, 0));
    }
  },
);

When(
  '用户在已打开过的话题之间来回切换',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld) {
    const { fixture } = perf(this);
    const rotation = [0, 1, 2];

    await openChat(this.page, fixture, 0);
    // Load the other topics once so every measured switch reads from memory.
    await switchTopic(this.page, fixture, 1);
    await switchTopic(this.page, fixture, 2);

    for (let i = 0; i < CACHED_SWITCHES; i += 1) {
      record(this, 'switchCached', await switchTopic(this.page, fixture, rotation[i % 3]));
    }
  },
);

When(
  '用户每次刷新页面后切换到另一个话题',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld) {
    const { fixture } = perf(this);

    // Visit every target once so its transcript sits in the IndexedDB replica.
    await openChat(this.page, fixture, 0);
    for (let i = 1; i <= UNCACHED_SWITCHES; i += 1) await switchTopic(this.page, fixture, i);

    for (let i = 1; i <= UNCACHED_SWITCHES; i += 1) {
      await openChat(this.page, fixture, i - 1);
      record(this, 'switchUncached', await switchTopic(this.page, fixture, i));
    }
  },
);

When(
  '用户每次在全新的浏览器环境中打开 chat 后切换到另一个话题',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld) {
    const { fixture } = perf(this);
    const cookies = await this.browserContext.cookies();

    for (let i = 1; i <= COLD_SWITCHES; i += 1) {
      // A new context has no HTTP cache and no IndexedDB replica.
      const context = await this.browser.newContext({
        baseURL: this.baseUrl,
        viewport: { height: 720, width: 1280 },
      });
      try {
        await context.addCookies(cookies);
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        await openChat(page, fixture, 0);
        record(this, 'switchCold', await switchTopic(page, fixture, i));
      } finally {
        await context.close();
      }
    }
  },
);

// ============================================
// Then
// ============================================

Then('{string} 场景的渲染不超过预算', function (this: CustomWorld, scenario: ChatRenderScenario) {
  const reports = perf(this).reports[scenario] ?? [];
  expect(reports.length, `no ${scenario} samples were recorded`).toBeGreaterThan(0);

  const runner = resolveRunnerKind();
  const budget = CHAT_RENDER_BUDGETS[runner][scenario];
  const summary = summarizeReports(reports);
  const violations = findBudgetViolations(scenario, summary, budget);

  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RECEIPT_DIR, `${scenario}.json`),
    JSON.stringify({ budget, reports, runner, scenario, summary, violations }, null, 2),
  );
  console.log(`   📊 ${scenario} (${runner}) p50: ${JSON.stringify(summary)}`);

  if (violations.length > 0) {
    throw new Error(`Render budget exceeded:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
  }
});

After({ tags: '@render-budget' }, async function (this: CustomWorld) {
  const context = this.testContext.perf as PerfContext | undefined;
  if (context) await removeChatFixture(context.fixture);
});
