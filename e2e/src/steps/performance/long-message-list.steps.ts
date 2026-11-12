/**
 * Long message list render budget (T-13850).
 *
 * Seeds a topic of 500 / 1000 messages, opens it, then wheels to the oldest
 * message and back while sampling animation frames and row mounts in the page.
 * Every measurement is written to `reports/perf/` so CI keeps a receipt even
 * when the budget passes.
 */
import * as fs from 'node:fs';
import path from 'node:path';

import { Given, Then, When } from '@cucumber/cucumber';

import { getLongListBudget, type LongListSize } from '../../performance/budgets';
import { type FrameStats, summarizeFrames } from '../../performance/frameStats';
import {
  LAST_MESSAGE_MARKER,
  type LongConversationIds,
  seedLongConversation,
} from '../../performance/longConversation';
import {
  installFirstReadableProbe,
  nextFrames,
  readFirstReadableMs,
  readScrollerState,
  type RenderWindowSample,
  SCROLLER_SELECTOR,
  startRenderWindow,
  stopRenderWindow,
} from '../../performance/pageProbes';
import { TEST_USER } from '../../support/seedTestUser';
import type { CustomWorld } from '../../support/world';

const SCROLL_STEP_TIMEOUT = 180_000;
/** One wheel notch of a fast flick; small enough that every row passes the viewport. */
const WHEEL_DELTA_PX = 800;
/** Consecutive settled reads before an edge counts as reached (paging can still shift it). */
const SETTLED_READS = 5;
const EDGE_TOLERANCE_PX = 2;

interface ScrollPassReceipt extends FrameStats {
  direction: 'toBottom' | 'toTop';
  durationMs: number;
  /** Long frames over all sampled frame gaps. */
  longFrameShare: number;
  maxMountedRows: number;
  rowMounts: number;
  rowMountsPerMessage: number;
  wheelSteps: number;
}

interface LongListReceipt {
  firstMessageId: string;
  firstReadableMs: number | null;
  lastMessageId: string;
  passes: ScrollPassReceipt[];
  runner: 'ci' | 'local';
  size: LongListSize;
  violations: string[];
}

const receiptOf = (world: CustomWorld): LongListReceipt => {
  const receipt = world.testContext.longListReceipt as LongListReceipt | undefined;
  if (!receipt) throw new Error('Long conversation was not seeded in this scenario');
  return receipt;
};

const writeReceipt = (receipt: LongListReceipt) => {
  const dir = path.join(process.cwd(), 'reports', 'perf');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `long-message-list-${receipt.size}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
};

/** Record and report the violations of one check; the scenario fails on any. */
const enforce = (receipt: LongListReceipt, checks: Array<[ok: boolean, message: string]>) => {
  const violations = checks.filter(([ok]) => !ok).map(([, message]) => message);
  receipt.violations.push(...violations);
  writeReceipt(receipt);
  if (violations.length > 0) {
    throw new Error(
      `Long list (${receipt.size} messages) over budget:\n- ${violations.join('\n- ')}`,
    );
  }
};

Given(
  '用户有一个包含 {int} 条消息的长对话',
  { timeout: 60_000 },
  async function (this: CustomWorld, count: number) {
    const size = count as LongListSize;
    const ids: LongConversationIds = {
      // TEST_USER.id already carries the run and worker scope.
      agentId: `agt_longlist_${TEST_USER.id}`,
      topicId: `tpc_longlist_${size}_${TEST_USER.id}`,
      userId: TEST_USER.id,
    };
    const rows = await seedLongConversation(ids, size);

    this.testContext.longListIds = ids;
    this.testContext.longListReceipt = {
      firstMessageId: rows.messages[0].id,
      firstReadableMs: null,
      lastMessageId: rows.lastMessageId,
      passes: [],
      runner: process.env.CI ? 'ci' : 'local',
      size,
      violations: [],
    } satisfies LongListReceipt;
    // Replace an earlier run's receipt now, so a scenario that dies early cannot leave it behind.
    writeReceipt(this.testContext.longListReceipt);
    console.log(`   📍 Seeded ${size} messages into ${ids.topicId}`);
  },
);

When('用户打开这个长对话', { timeout: 60_000 }, async function (this: CustomWorld) {
  const ids = this.testContext.longListIds as LongConversationIds;
  const receipt = receiptOf(this);

  // Warm the app bundles and server on the agent's empty chat first. Without it
  // the first scenario of each run paid 1-2 s of cold-start noise (2.8-6.5 s
  // vs 1.8-4.7 s for the second). The topic's messages stay uncached.
  await this.page.goto(`/agent/${ids.agentId}`, { waitUntil: 'domcontentloaded' });
  await this.page.locator('[data-testid="chat-input"]').first().waitFor({ timeout: 45_000 });

  await installFirstReadableProbe(this.page, {
    marker: LAST_MESSAGE_MARKER,
    messageId: receipt.lastMessageId,
  });
  await this.page.goto(`/agent/${ids.agentId}/${ids.topicId}`, { waitUntil: 'domcontentloaded' });

  // Wait without a budget here; the Then step judges the recorded time.
  try {
    await this.page.waitForFunction(
      `window.__lobehubE2EFirstReadable && window.__lobehubE2EFirstReadable.at !== null`,
      undefined,
      { timeout: 45_000 },
    );
  } catch {
    enforce(receipt, [[false, 'newest message never became readable within 45 s']]);
  }
  receipt.firstReadableMs = Math.round((await readFirstReadableMs(this.page))!);
  console.log(`   📍 Newest message readable after ${receipt.firstReadableMs} ms`);
});

Then('最新消息应在首屏可读预算内出现', async function (this: CustomWorld) {
  const receipt = receiptOf(this);
  const budget = getLongListBudget(receipt.size).timing.firstReadableMs;

  enforce(receipt, [
    [
      receipt.firstReadableMs !== null && receipt.firstReadableMs <= budget,
      `first readable ${receipt.firstReadableMs} ms > ${budget} ms`,
    ],
  ]);
});

const toPass = (
  receipt: LongListReceipt,
  direction: ScrollPassReceipt['direction'],
  sample: RenderWindowSample,
  startedAt: number,
  wheelSteps: number,
): ScrollPassReceipt => {
  const frames = summarizeFrames(sample.timestamps);
  return {
    ...frames,
    direction,
    durationMs: Date.now() - startedAt,
    longFrameShare:
      frames.frames > 1 ? Math.round((frames.longFrames / (frames.frames - 1)) * 1000) / 1000 : 0,
    maxMountedRows: sample.maxMountedRows,
    rowMounts: sample.rowMounts,
    rowMountsPerMessage: Math.round((sample.rowMounts / receipt.size) * 100) / 100,
    wheelSteps,
  };
};

const scrollToEdge = async (world: CustomWorld, direction: ScrollPassReceipt['direction']) => {
  const receipt = receiptOf(world);
  const edgeMessageId = direction === 'toTop' ? receipt.firstMessageId : receipt.lastMessageId;
  const scroller = world.page.locator(SCROLLER_SELECTOR).first();
  const box = await scroller.boundingBox();
  if (!box) throw new Error('Conversation scroller is not visible');

  // Upper part of the list: the chat input floats over its bottom edge.
  await world.page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
  await nextFrames(world.page);

  await startRenderWindow(world.page);
  const startedAt = Date.now();
  let wheelSteps = 0;
  let settled = 0;

  while (settled < SETTLED_READS) {
    if (Date.now() - startedAt > SCROLL_STEP_TIMEOUT - 20_000) {
      // Keep what was sampled so the receipt shows where the pass stalled.
      receipt.passes.push(
        toPass(receipt, direction, await stopRenderWindow(world.page), startedAt, wheelSteps),
      );
      enforce(receipt, [[false, `scroll ${direction} did not reach ${edgeMessageId} in time`]]);
    }

    // Wheel steps are sequential: each one depends on the position the last one left.
    await world.page.mouse.wheel(0, direction === 'toTop' ? -WHEEL_DELTA_PX : WHEEL_DELTA_PX);
    wheelSteps += 1;
    await nextFrames(world.page);
    const state = await readScrollerState(world.page);
    const atEdge =
      !!state &&
      state.mountedIds.includes(edgeMessageId) &&
      (direction === 'toTop'
        ? state.scrollTop <= EDGE_TOLERANCE_PX
        : state.scrollHeight - state.scrollTop - state.clientHeight <= EDGE_TOLERANCE_PX);
    settled = atEdge ? settled + 1 : 0;
  }

  const pass = toPass(
    receipt,
    direction,
    await stopRenderWindow(world.page),
    startedAt,
    wheelSteps,
  );
  receipt.passes.push(pass);
  console.log(`   📍 Scroll ${direction}: ${JSON.stringify(pass)}`);
};

When(
  '用户用滚轮从底部滚到对话最早的消息',
  { timeout: SCROLL_STEP_TIMEOUT },
  async function (this: CustomWorld) {
    await scrollToEdge(this, 'toTop');
  },
);

When(
  '用户用滚轮从顶部滚回对话最新的消息',
  { timeout: SCROLL_STEP_TIMEOUT },
  async function (this: CustomWorld) {
    await scrollToEdge(this, 'toBottom');
  },
);

Then('这次滚动的帧间隔和消息行挂载数应在预算内', async function (this: CustomWorld) {
  const receipt = receiptOf(this);
  const pass = receipt.passes.at(-1);
  if (!pass) throw new Error('No scroll pass was recorded');
  const { counts, timing } = getLongListBudget(receipt.size);
  const label = `scroll ${pass.direction}`;

  enforce(receipt, [
    [
      pass.maxGapMs <= timing.scroll.maxGapMs,
      `${label} max frame gap ${pass.maxGapMs} ms > ${timing.scroll.maxGapMs} ms`,
    ],
    [
      pass.longFrameShare <= timing.scroll.longFrameShare,
      `${label} long-frame share ${pass.longFrameShare} > ${timing.scroll.longFrameShare} (${pass.longFrames}/${pass.frames} frames)`,
    ],
    [
      pass.maxMountedRows <= counts.maxMountedRows,
      `${label} mounted rows ${pass.maxMountedRows} > ${counts.maxMountedRows}`,
    ],
    [
      pass.rowMountsPerMessage <= counts.rowMountsPerMessage,
      `${label} row mounts per message ${pass.rowMountsPerMessage} > ${counts.rowMountsPerMessage}`,
    ],
  ]);
});
