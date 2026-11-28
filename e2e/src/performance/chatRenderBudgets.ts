import type { ChatRenderScenario, RunnerKind, ScenarioBudget } from './renderBudget';
import { RENDER_REGIONS, type RenderRegion } from './renderProfile';

/**
 * Render budgets for opening and switching chats, gated on the p50 of each
 * scenario's samples (`renders` / `actualDurationMs` per region, ms for the
 * frame gap).
 *
 * Local baseline for durations (2026-11-13, M5 Max, headless Chromium, 3 runs,
 * p50 range; durations swing up to 2x with machine load):
 *
 * | scenario       | sidebar        | conversation     | messages        | frame gap  |
 * | -------------- | -------------- | ---------------- | --------------- | ---------- |
 * | open           | 19–21× 28–33ms | 59–69× 106–130ms | 34–35× 45–59ms  | 133–150ms  |
 * | switchCached   | 7× 5–10ms      | 18× 34–57ms      | 8× 11–22ms      | 33–100ms   |
 * | switchUncached | 9× 8–13ms      | 43× 59–93ms      | 27× 36–56ms     | 33–67ms    |
 * | switchCold     | 9× 8–14ms      | 43–45× 56–97ms   | 26× 32–60ms     | 33–83ms    |
 *
 * Render counts were re-measured on 2026-11-27 from CI receipts after
 * local-replica 0.4.1 and the topic-switch fixes landed (p50 range over
 * 3 canary runs; render counts match local):
 *
 * | scenario       | sidebar | conversation | messages |
 * | -------------- | ------- | ------------ | -------- |
 * | open           | 14–15×  | 59–62×       | 30–31×   |
 * | switchCached   | 8×      | 12×          | 6×       |
 * | switchUncached | 8×      | 36×          | 24×      |
 * | switchCold     | 8×      | 33–35×       | 22×      |
 *
 * Render counts barely move between runs, so their ceilings sit about 20%
 * above the baseline and catch a new re-render loop. Durations move with
 * machine load, so they allow about twice the baseline and catch only gross
 * regressions. Re-measure with `bun run test:perf` (receipts in
 * `reports/render-budget/`) before changing a number.
 */
const LOCAL: Record<ChatRenderScenario, ScenarioBudget> = {
  open: {
    maxFrameGapMs: 300,
    regions: {
      conversation: { actualDurationMs: 260, renders: 75 },
      messages: { actualDurationMs: 120, renders: 37 },
      sidebar: { actualDurationMs: 70, renders: 18 },
    },
  },
  switchCached: {
    maxFrameGapMs: 200,
    regions: {
      conversation: { actualDurationMs: 120, renders: 15 },
      messages: { actualDurationMs: 50, renders: 8 },
      sidebar: { actualDurationMs: 30, renders: 9 },
    },
  },
  switchCold: {
    maxFrameGapMs: 200,
    regions: {
      conversation: { actualDurationMs: 200, renders: 42 },
      messages: { actualDurationMs: 120, renders: 27 },
      sidebar: { actualDurationMs: 35, renders: 10 },
    },
  },
  switchUncached: {
    maxFrameGapMs: 170,
    regions: {
      conversation: { actualDurationMs: 190, renders: 43 },
      messages: { actualDurationMs: 120, renders: 29 },
      sidebar: { actualDurationMs: 30, renders: 10 },
    },
  },
};

/**
 * GitHub-hosted `ubuntu-latest` runners. Render counts match local, so they
 * reuse the local ceilings. Durations and frame gaps allow about 2.5 times the
 * first CI receipt (PR #22936, 1 run, p50):
 *
 * | scenario       | sidebar   | conversation | messages  | frame gap |
 * | -------------- | --------- | ------------ | --------- | --------- |
 * | open           | 21× 67ms  | 58× 211ms    | 34× 95ms  | 217ms     |
 * | switchCached   | 7× 10ms   | 19× 59ms     | 8× 25ms   | 83ms      |
 * | switchUncached | 9× 17ms   | 46× 103ms    | 28× 62ms  | 83ms      |
 * | switchCold     | 9× 17ms   | 43× 111ms    | 26× 68ms  | 100ms     |
 *
 * Receipts are uploaded as the `render-budget` artifact of the
 * `Render Budget` job.
 */
const withCiTiming = (
  scenario: ChatRenderScenario,
  maxFrameGapMs: number,
  durations: Record<RenderRegion, number>,
): ScenarioBudget => ({
  maxFrameGapMs,
  regions: Object.fromEntries(
    RENDER_REGIONS.map((region) => [
      region,
      { actualDurationMs: durations[region], renders: LOCAL[scenario].regions[region].renders },
    ]),
  ) as ScenarioBudget['regions'],
});

const CI: Record<ChatRenderScenario, ScenarioBudget> = {
  open: withCiTiming('open', 550, { conversation: 530, messages: 240, sidebar: 170 }),
  switchCached: withCiTiming('switchCached', 210, { conversation: 150, messages: 65, sidebar: 30 }),
  switchCold: withCiTiming('switchCold', 250, { conversation: 280, messages: 170, sidebar: 45 }),
  switchUncached: withCiTiming('switchUncached', 210, {
    conversation: 260,
    messages: 160,
    sidebar: 45,
  }),
};

export const CHAT_RENDER_BUDGETS: Record<RunnerKind, Record<ChatRenderScenario, ScenarioBudget>> = {
  ci: CI,
  local: LOCAL,
};
