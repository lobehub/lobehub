import type { RunnerKind, ScenarioBudget } from './renderBudget';
import { RENDER_REGIONS, type RenderRegion } from './renderProfile';
import type { StreamingWorkload } from './streamingWorkloads';

export type StreamingScenario =
  | StreamingWorkload
  /** `bigstream` streaming in another topic while the user reads a finished one. */
  | 'background';

export interface StreamingBudget extends ScenarioBudget {
  /** Ceiling for the p50 of JS heap growth across one reply, after forced GC, in MB. */
  heapGrowthMb: number;
}

/**
 * Render and memory budgets while a reply streams, gated on the p50 of each
 * scenario's samples (`renders` / `actualDurationMs` per region, ms for the
 * frame gap, MB for heap growth).
 *
 * Local baseline (2026-11-13, M5 Max, headless Chromium, 3 runs, p50 range):
 *
 * | scenario   | sidebar        | conversation       | messages           | frame gap | heap        |
 * | ---------- | -------------- | ------------------ | ------------------ | --------- | ----------- |
 * | bigstream  | 32–33× 18–41ms | 358–364× 286–588ms | 251–257× 203–407ms | 67–233ms  | 10.9–11.7MB |
 * | toolstorm  | 21–23× 18–34ms | 101–107× 101–219ms | 83–84× 47–105ms    | 67–183ms  | 23.4–23.6MB |
 * | richreply  | 28× 23–32ms    | 216–224× 341–496ms | 162–172× 260–381ms | 283–400ms | 11.0–13.2MB |
 * | background | 18× 5–7ms      | 9–10× 7–10ms       | 5× 1–2ms           | 17ms      | 1.8–2.7MB   |
 *
 * Render counts barely move between runs because the mock streams on a
 * wall-clock schedule, so their ceilings sit about 20% above the highest p50
 * and catch a new re-render loop. Durations and frame gaps move with machine
 * load, so they allow about twice it; heap allows about 30% more. Re-measure
 * with `bun run test:perf` (receipts in `reports/render-budget/stream-*.json`)
 * before changing a number, and after changing a reply or its pacing in
 * `streamingWorkloads.ts`.
 */
const LOCAL: Record<StreamingScenario, StreamingBudget> = {
  background: {
    heapGrowthMb: 5,
    maxFrameGapMs: 100,
    regions: {
      conversation: { actualDurationMs: 20, renders: 12 },
      messages: { actualDurationMs: 5, renders: 6 },
      sidebar: { actualDurationMs: 15, renders: 22 },
    },
  },
  bigstream: {
    heapGrowthMb: 16,
    maxFrameGapMs: 470,
    regions: {
      conversation: { actualDurationMs: 1200, renders: 440 },
      messages: { actualDurationMs: 820, renders: 310 },
      sidebar: { actualDurationMs: 85, renders: 40 },
    },
  },
  richreply: {
    heapGrowthMb: 18,
    maxFrameGapMs: 800,
    regions: {
      conversation: { actualDurationMs: 1000, renders: 270 },
      messages: { actualDurationMs: 770, renders: 210 },
      sidebar: { actualDurationMs: 65, renders: 34 },
    },
  },
  toolstorm: {
    heapGrowthMb: 31,
    maxFrameGapMs: 370,
    regions: {
      conversation: { actualDurationMs: 440, renders: 130 },
      messages: { actualDurationMs: 210, renders: 101 },
      sidebar: { actualDurationMs: 70, renders: 28 },
    },
  },
};

/**
 * GitHub-hosted `ubuntu-latest` runners. Render counts and heap growth match
 * local, so they reuse the local ceilings. Durations and frame gaps allow about
 * 2.5 times the first CI receipt (PR #22968, 1 run, p50):
 *
 * | scenario   | sidebar  | conversation | messages   | frame gap | heap   |
 * | ---------- | -------- | ------------ | ---------- | --------- | ------ |
 * | bigstream  | 32× 48ms | 350× 637ms   | 249× 447ms | 217ms     | 11.5MB |
 * | toolstorm  | 23× 45ms | 105× 243ms   | 84× 110ms  | 217ms     | 23.4MB |
 * | richreply  | 27× 43ms | 203× 615ms   | 154× 464ms | 533ms     | 13.1MB |
 * | background | 17× 9ms  | 8× 13ms      | 5× 2ms     | 17ms      | 2.3MB  |
 *
 * Receipts are uploaded as the `render-budget` artifact of the
 * `Render Budget` job.
 */
const withCiTiming = (
  scenario: StreamingScenario,
  maxFrameGapMs: number,
  durations: Record<RenderRegion, number>,
): StreamingBudget => ({
  ...LOCAL[scenario],
  maxFrameGapMs,
  regions: Object.fromEntries(
    RENDER_REGIONS.map((region) => [
      region,
      { actualDurationMs: durations[region], renders: LOCAL[scenario].regions[region].renders },
    ]),
  ) as StreamingBudget['regions'],
});

const CI: Record<StreamingScenario, StreamingBudget> = {
  // The frame gap stays at the local ceiling: an idle page paints every frame on both.
  background: withCiTiming('background', 100, { conversation: 34, messages: 6, sidebar: 22 }),
  bigstream: withCiTiming('bigstream', 540, { conversation: 1600, messages: 1100, sidebar: 120 }),
  richreply: withCiTiming('richreply', 1330, {
    conversation: 1540,
    messages: 1160,
    sidebar: 110,
  }),
  toolstorm: withCiTiming('toolstorm', 540, { conversation: 610, messages: 275, sidebar: 115 }),
};

export const STREAMING_RENDER_BUDGETS: Record<
  RunnerKind,
  Record<StreamingScenario, StreamingBudget>
> = {
  ci: CI,
  local: LOCAL,
};
