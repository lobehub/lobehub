import { RENDER_REGIONS, type RenderRegion, type RenderReport } from './renderProfile';

export const CHAT_RENDER_SCENARIOS = [
  /** Load the chat page with the browser cache warm (a returning user opening a chat link). */
  'open',
  /** Switch to a topic whose messages are already in memory. */
  'switchCached',
  /** First switch after a reload: memory is empty, the IndexedDB transcript replica is not. */
  'switchUncached',
  /** First switch in a fresh browser profile: no HTTP cache, no IndexedDB, messages come from the server. */
  'switchCold',
] as const;

export type ChatRenderScenario = (typeof CHAT_RENDER_SCENARIOS)[number];

export interface Stat {
  max: number;
  p50: number;
}

export interface ScenarioSummary {
  maxFrameGapMs: Stat;
  regions: Record<RenderRegion, { actualDurationMs: Stat; renders: Stat }>;
  samples: number;
}

export interface RegionBudget {
  /** Ceiling for the p50 of summed `actualDuration` across the scenario. */
  actualDurationMs: number;
  /** Ceiling for the p50 of commits that rendered inside the region. */
  renders: number;
}

export interface ScenarioBudget {
  /** Ceiling for the p50 of the longest gap between two animation frames. */
  maxFrameGapMs: number;
  regions: Record<RenderRegion, RegionBudget>;
}

export type RunnerKind = 'ci' | 'local';

/** Nearest-rank percentile: always one of the measured samples, never an interpolation. */
const stat = (values: number[]): Stat => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(sorted.length * 0.5) - 1);
  return { max: sorted.at(-1) ?? 0, p50: sorted[rank] ?? 0 };
};

export const summarizeReports = (reports: RenderReport[]): ScenarioSummary => ({
  maxFrameGapMs: stat(reports.map((report) => report.frames.maxGapMs)),
  regions: Object.fromEntries(
    RENDER_REGIONS.map((region) => [
      region,
      {
        actualDurationMs: stat(reports.map((report) => report.regions[region].actualDurationMs)),
        renders: stat(reports.map((report) => report.regions[region].renders)),
      },
    ]),
  ) as ScenarioSummary['regions'],
  samples: reports.length,
});

/**
 * Budgets gate the p50 so one sample slowed by a busy runner does not fail the
 * PR; the receipt keeps the max for investigation.
 */
export const findBudgetViolations = (
  scenario: ChatRenderScenario,
  summary: ScenarioSummary,
  budget: ScenarioBudget,
): string[] => {
  const violations: string[] = [];

  for (const region of RENDER_REGIONS) {
    const actual = summary.regions[region];
    const limit = budget.regions[region];

    if (actual.renders.p50 > limit.renders) {
      violations.push(
        `${scenario} › ${region}: ${actual.renders.p50} renders (p50) > budget ${limit.renders}`,
      );
    }
    if (actual.actualDurationMs.p50 > limit.actualDurationMs) {
      violations.push(
        `${scenario} › ${region}: ${actual.actualDurationMs.p50}ms render time (p50) > budget ${limit.actualDurationMs}ms`,
      );
    }
  }

  if (summary.maxFrameGapMs.p50 > budget.maxFrameGapMs) {
    violations.push(
      `${scenario} › longest frame gap ${summary.maxFrameGapMs.p50}ms (p50) > budget ${budget.maxFrameGapMs}ms`,
    );
  }

  return violations;
};

export const resolveRunnerKind = (env: NodeJS.ProcessEnv = process.env): RunnerKind =>
  env.CI ? 'ci' : 'local';
