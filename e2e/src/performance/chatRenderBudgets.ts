import type { ChatRenderScenario, RunnerKind, ScenarioBudget } from './renderBudget';

/**
 * Render budgets for opening and switching chats, gated on the p50 of each
 * scenario's samples (`renders` / `actualDurationMs` per region, ms for the
 * frame gap).
 *
 * Local baseline (2026-11-13, M5 Max, headless Chromium, 3 runs, p50 range; durations
 * swing up to 2x with machine load):
 *
 * | scenario       | sidebar        | conversation     | messages        | frame gap  |
 * | -------------- | -------------- | ---------------- | --------------- | ---------- |
 * | open           | 19–21× 28–33ms | 59–69× 106–130ms | 34–35× 45–59ms  | 133–150ms  |
 * | switchCached   | 7× 5–10ms      | 18× 34–57ms      | 8× 11–22ms      | 33–100ms   |
 * | switchUncached | 9× 8–13ms      | 43× 59–93ms      | 27× 36–56ms     | 33–67ms    |
 * | switchCold     | 9× 8–14ms      | 43–45× 56–97ms   | 26× 32–60ms     | 33–83ms    |
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
      conversation: { actualDurationMs: 260, renders: 80 },
      messages: { actualDurationMs: 120, renders: 42 },
      sidebar: { actualDurationMs: 70, renders: 25 },
    },
  },
  switchCached: {
    maxFrameGapMs: 200,
    regions: {
      conversation: { actualDurationMs: 120, renders: 22 },
      messages: { actualDurationMs: 50, renders: 10 },
      sidebar: { actualDurationMs: 30, renders: 9 },
    },
  },
  switchCold: {
    maxFrameGapMs: 200,
    regions: {
      conversation: { actualDurationMs: 200, renders: 54 },
      messages: { actualDurationMs: 120, renders: 32 },
      sidebar: { actualDurationMs: 35, renders: 11 },
    },
  },
  switchUncached: {
    maxFrameGapMs: 170,
    regions: {
      conversation: { actualDurationMs: 190, renders: 52 },
      messages: { actualDurationMs: 120, renders: 33 },
      sidebar: { actualDurationMs: 30, renders: 11 },
    },
  },
};

/**
 * GitHub-hosted `ubuntu-latest` runners. Provisional: render counts as local,
 * durations and frame gaps three times local, until CI receipts calibrate them.
 */
const CI: Record<ChatRenderScenario, ScenarioBudget> = Object.fromEntries(
  Object.entries(LOCAL).map(([scenario, budget]) => [
    scenario,
    {
      maxFrameGapMs: budget.maxFrameGapMs * 3,
      regions: Object.fromEntries(
        Object.entries(budget.regions).map(([region, limit]) => [
          region,
          { actualDurationMs: limit.actualDurationMs * 3, renders: limit.renders },
        ]),
      ),
    },
  ]),
) as Record<ChatRenderScenario, ScenarioBudget>;

export const CHAT_RENDER_BUDGETS: Record<RunnerKind, Record<ChatRenderScenario, ScenarioBudget>> = {
  ci: CI,
  local: LOCAL,
};
