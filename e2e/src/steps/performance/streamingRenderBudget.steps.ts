/**
 * Render and memory budgets while a reply streams. They need a server built
 * with `LOBE_REACT_PROFILING=1` and run only under `E2E_PERF=1`; see
 * `e2e/src/features/performance/streaming-render-budget.feature`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { Then, When } from '@cucumber/cucumber';
import type { CDPSession, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { LLM_ACTIVE_STREAMS_GLOBAL, llmMockManager } from '../../mocks/llm';
import type { ChatFixture } from '../../performance/chatFixture';
import { collectedHeapMb, openCdpSession } from '../../performance/heap';
import {
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
import {
  STREAMING_RENDER_BUDGETS,
  type StreamingScenario,
} from '../../performance/streamingRenderBudgets';
import {
  streamingResponder,
  type StreamingWorkload,
  WORKLOAD_FINAL_TEXT,
  workloadPrompt,
} from '../../performance/streamingWorkloads';
import type { CustomWorld } from '../../support/world';

/** Samples per scenario; budgets gate their p50. */
const SAMPLES = 3;
const LOOP_TIMEOUT = 300_000;
const REPLY_TIMEOUT = 60_000;

const RECEIPT_DIR = path.join(process.cwd(), 'reports', 'render-budget');

interface StreamingSample {
  heapBeforeMb: number;
  heapGrowthMb: number;
  report: RenderReport;
}

interface StreamingContext {
  cdp: CDPSession;
  samples: Partial<Record<StreamingScenario, StreamingSample[]>>;
}

/** Seeded by the shared `用户有一个带多个历史话题的 Agent` step, removed by its `@render-budget` hook. */
const fixtureOf = (world: CustomWorld): ChatFixture => world.testContext.perf.fixture;

const streaming = (world: CustomWorld): StreamingContext => world.testContext.streaming;

const topicItem = (page: Page, fixture: ChatFixture, index: number) =>
  page.locator(`[data-testid="topic-item"][data-topic-id="${fixture.topicIds[index]}"]`);

const activeStreams = (page: Page) =>
  page.evaluate<number>(`window.${LLM_ACTIVE_STREAMS_GLOBAL} || 0`);

/** Loads a page and ends the `boot` scenario the profiling build starts on its own. */
const openPage = async (page: Page, url: string, ready: () => Promise<void>) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  await assertProfilingBuild(page);
  await endProfileWhenSettled(page);
};

/** Opens a new conversation with the fixture agent, so every sample starts from an empty chat. */
const openNewChat = (page: Page, fixture: ChatFixture) =>
  openPage(page, `/agent/${fixture.agentId}`, () =>
    expect(page.locator('[data-testid="chat-input"]').first()).toBeVisible({ timeout: 30_000 }),
  );

/** Types the prompt without sending it, so the typing commits stay outside the measurement. */
const fillPrompt = async (page: Page, workload: StreamingWorkload) => {
  const input = page.locator('[data-testid="chat-input"] [contenteditable="true"]').first();
  await input.click();
  await page.keyboard.insertText(workloadPrompt(workload));
  // Park the pointer on an empty area so hover cards stay closed.
  await page.mouse.move(900, 120);
};

const waitForReply = async (page: Page, workload: StreamingWorkload) => {
  await expect(page.getByText(WORKLOAD_FINAL_TEXT[workload]).first()).toBeVisible({
    timeout: REPLY_TIMEOUT,
  });
  await expect.poll(() => activeStreams(page), { timeout: REPLY_TIMEOUT }).toBe(0);
};

const record = (world: CustomWorld, scenario: StreamingScenario, sample: StreamingSample) => {
  const samples = (streaming(world).samples[scenario] ??= []);
  samples.push(sample);
  console.log(
    `   📏 ${scenario} #${samples.length}: ` +
      Object.entries(sample.report.regions)
        .map(([region, r]) => `${region} ${r.renders}× ${r.actualDurationMs}ms`)
        .join(', ') +
      `, max frame gap ${sample.report.frames.maxGapMs}ms, heap +${sample.heapGrowthMb}MB`,
  );
};

const setupStreaming = async (world: CustomWorld) => {
  llmMockManager.clearResponses();
  llmMockManager.addResponder(streamingResponder);
  await llmMockManager.setup(world.page);
  world.testContext.streaming = {
    cdp: await openCdpSession(world.page),
    samples: {},
  } satisfies StreamingContext;
};

/**
 * Sends one prompt in a new chat and measures from Enter until the reply is
 * drawn complete and React has gone quiet.
 */
const measureReply = async (world: CustomWorld, workload: StreamingWorkload) => {
  const { page } = world;
  const { cdp } = streaming(world);

  await openNewChat(page, fixtureOf(world));
  await fillPrompt(page, workload);
  const heapBeforeMb = await collectedHeapMb(cdp);

  await beginProfile(page, `stream:${workload}`);
  await page.keyboard.press('Enter');
  await waitForReply(page, workload);
  const report = await endProfileWhenSettled(page);

  const heapGrowthMb = Math.round(((await collectedHeapMb(cdp)) - heapBeforeMb) * 10) / 10;
  return { heapBeforeMb, heapGrowthMb, report } satisfies StreamingSample;
};

// ============================================
// When
// ============================================

When(
  '用户多次在新对话中收到 {string} 流式回复',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld, workload: StreamingWorkload) {
    await setupStreaming(this);

    // One unmeasured reply loads the lazy chat code (Markdown, highlighting, tool renders).
    await measureReply(this, workload);

    for (let i = 0; i < SAMPLES; i += 1) record(this, workload, await measureReply(this, workload));
  },
);

When(
  '用户在一个对话流式输出时多次切换到另一个话题等待它完成',
  { timeout: LOOP_TIMEOUT },
  async function (this: CustomWorld) {
    await setupStreaming(this);
    const { page } = this;
    const { cdp } = streaming(this);
    const fixture = fixtureOf(this);

    // Every round streams into its own seeded topic, so each background transcript
    // starts the same size, while the last topic stays in front.
    const front = fixture.topicIds.length - 1;

    for (let i = 0; i <= SAMPLES; i += 1) {
      await openPage(page, `/agent/${fixture.agentId}/${fixture.topicIds[i]}`, () =>
        expect(page.getByText(fixture.markers[i]).first()).toBeVisible({ timeout: 30_000 }),
      );
      await fillPrompt(page, 'bigstream');
      await page.keyboard.press('Enter');
      await expect(page.getByText('Section 1', { exact: true }).first()).toBeVisible({
        timeout: REPLY_TIMEOUT,
      });

      await topicItem(page, fixture, front).click();
      await expect(page.getByText(fixture.markers[front]).first()).toBeVisible({ timeout: 30_000 });
      const heapBeforeMb = await collectedHeapMb(cdp);
      // The switch itself is covered by the chat switch budgets; measure only the wait.
      await page.waitForTimeout(300);

      // A switch that cancelled the reply would leave an idle page to measure.
      expect(await activeStreams(page), 'background reply stopped before the measurement').toBe(1);
      await beginProfile(page, 'stream:background');
      await expect.poll(() => activeStreams(page), { timeout: REPLY_TIMEOUT }).toBe(0);
      const report = await endProfileWhenSettled(page);
      const heapGrowthMb = Math.round(((await collectedHeapMb(cdp)) - heapBeforeMb) * 10) / 10;

      // Outside the measurement: the background reply finished instead of being cut off.
      await topicItem(page, fixture, i).click();
      await expect(page.getByText(WORKLOAD_FINAL_TEXT.bigstream).first()).toBeVisible({
        timeout: 30_000,
      });

      // The first round loads the lazy chat code and is not counted.
      if (i > 0) record(this, 'background', { heapBeforeMb, heapGrowthMb, report });
    }
  },
);

// ============================================
// Then
// ============================================

Then(
  '{string} 流式场景的渲染与内存不超过预算',
  function (this: CustomWorld, scenario: StreamingScenario) {
    const samples = streaming(this).samples[scenario] ?? [];
    expect(samples.length, `no ${scenario} samples were recorded`).toBeGreaterThan(0);

    const runner = resolveRunnerKind();
    const budget = STREAMING_RENDER_BUDGETS[runner][scenario];
    const reports = samples.map((sample) => sample.report);
    const summary = summarizeReports(reports);
    const heapGrowth = samples.map((sample) => sample.heapGrowthMb).sort((a, b) => a - b);
    const heapGrowthMb = {
      max: heapGrowth.at(-1) ?? 0,
      p50: heapGrowth[Math.max(0, Math.ceil(heapGrowth.length / 2) - 1)] ?? 0,
    };

    const violations = findBudgetViolations(scenario, summary, budget);
    if (heapGrowthMb.p50 > budget.heapGrowthMb) {
      violations.push(
        `${scenario} › heap growth ${heapGrowthMb.p50}MB (p50) > budget ${budget.heapGrowthMb}MB`,
      );
    }

    fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RECEIPT_DIR, `stream-${scenario}.json`),
      JSON.stringify(
        { budget, heapGrowthMb, runner, samples, scenario, summary, violations },
        null,
        2,
      ),
    );
    console.log(
      `   📊 ${scenario} (${runner}) p50: ${JSON.stringify({ ...summary, heapGrowthMb })}`,
    );

    if (violations.length > 0) {
      throw new Error(`Render budget exceeded:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
    }
  },
);
