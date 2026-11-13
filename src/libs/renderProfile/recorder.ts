/**
 * Screen regions wrapped in a `<RenderProfiler>`. Render-budget E2E scenarios
 * assert per-region budgets, so the list is closed: a new region needs a budget
 * entry in `e2e/src/performance/chatRenderBudgets.ts` before its numbers gate a PR.
 *
 * `conversation` is the whole chat column (header, message list and composer),
 * so its numbers include `messages`; React reports a commit to every
 * `<Profiler>` above the component that rendered.
 */
export const RENDER_PROFILE_REGIONS = ['sidebar', 'conversation', 'messages'] as const;

export type RenderProfileRegion = (typeof RENDER_PROFILE_REGIONS)[number];

export type RenderProfilePhase = 'mount' | 'update' | 'nested-update';

export interface RenderProfileRegionReport {
  /** Sum of `actualDuration` over every commit that touched the region. */
  actualDurationMs: number;
  /** Slowest single commit of the region. */
  maxActualDurationMs: number;
  mounts: number;
  /** Commits that rendered anything inside the region (mounts + updates). */
  renders: number;
  updates: number;
}

export interface RenderProfileReport {
  /** Distinct React commits seen by any region. */
  commitCount: number;
  durationMs: number;
  frames: {
    count: number;
    /** Longest gap between two consecutive animation frames, i.e. the worst visible stall. */
    maxGapMs: number;
  };
  label: string;
  /** Longest `long-animation-frame` entry; 0 when the browser lacks the API or none occurred. */
  longestAnimationFrameMs: number;
  regions: Record<RenderProfileRegion, RenderProfileRegionReport>;
}

export interface RenderProfileStatus {
  active: boolean;
  commitCount: number;
  frameCount: number;
  label?: string;
  /** `performance.now()` of the latest commit, used by tests to wait for the UI to settle. */
  lastCommitAt?: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

const emptyRegion = (): RenderProfileRegionReport => ({
  actualDurationMs: 0,
  maxActualDurationMs: 0,
  mounts: 0,
  renders: 0,
  updates: 0,
});

/**
 * Aggregates `<Profiler>` callbacks and frame timestamps for one scenario at a
 * time. Counters are folded in place, so a scenario left running for the whole
 * session (the automatic boot scenario) keeps constant memory.
 */
export class RenderProfileRecorder {
  #commits = new Set<number>();
  #frameCount = 0;
  #label?: string;
  #lastCommitAt?: number;
  #lastFrameAt?: number;
  #longestAnimationFrameMs = 0;
  #maxFrameGapMs = 0;
  #regions = {} as Record<RenderProfileRegion, RenderProfileRegionReport>;
  #startedAt = 0;

  constructor(private readonly now: () => number) {}

  get active() {
    return this.#label !== undefined;
  }

  begin(label: string) {
    if (this.#label !== undefined) {
      throw new Error(`Render profile "${this.#label}" is still active; end it first`);
    }

    this.#label = label;
    this.#startedAt = this.now();
    this.#commits = new Set();
    this.#frameCount = 0;
    this.#lastCommitAt = undefined;
    this.#lastFrameAt = undefined;
    this.#longestAnimationFrameMs = 0;
    this.#maxFrameGapMs = 0;
    this.#regions = Object.fromEntries(
      RENDER_PROFILE_REGIONS.map((region) => [region, emptyRegion()]),
    ) as Record<RenderProfileRegion, RenderProfileRegionReport>;
  }

  end(): RenderProfileReport {
    const label = this.#label;
    if (label === undefined) throw new Error('No render profile is active');

    this.#label = undefined;

    return {
      commitCount: this.#commits.size,
      durationMs: round(this.now() - this.#startedAt),
      frames: { count: this.#frameCount, maxGapMs: round(this.#maxFrameGapMs) },
      label,
      longestAnimationFrameMs: round(this.#longestAnimationFrameMs),
      regions: Object.fromEntries(
        RENDER_PROFILE_REGIONS.map((region) => {
          const report = this.#regions[region];
          return [
            region,
            {
              ...report,
              actualDurationMs: round(report.actualDurationMs),
              maxActualDurationMs: round(report.maxActualDurationMs),
            },
          ];
        }),
      ) as Record<RenderProfileRegion, RenderProfileRegionReport>,
    };
  }

  recordAnimationFrame(timestamp: number) {
    if (this.#label === undefined) return;

    if (this.#lastFrameAt !== undefined) {
      this.#maxFrameGapMs = Math.max(this.#maxFrameGapMs, timestamp - this.#lastFrameAt);
    }
    this.#lastFrameAt = timestamp;
    this.#frameCount += 1;
  }

  recordLongAnimationFrame(durationMs: number) {
    if (this.#label === undefined) return;

    this.#longestAnimationFrameMs = Math.max(this.#longestAnimationFrameMs, durationMs);
  }

  recordRender(
    region: RenderProfileRegion,
    phase: RenderProfilePhase,
    actualDuration: number,
    commitTime: number,
  ) {
    if (this.#label === undefined) return;

    const report = this.#regions[region];
    report.renders += 1;
    if (phase === 'mount') report.mounts += 1;
    else report.updates += 1;
    report.actualDurationMs += actualDuration;
    report.maxActualDurationMs = Math.max(report.maxActualDurationMs, actualDuration);

    this.#commits.add(commitTime);
    this.#lastCommitAt = this.now();
  }

  status(): RenderProfileStatus {
    return {
      active: this.active,
      commitCount: this.#commits.size,
      frameCount: this.#frameCount,
      label: this.#label,
      lastCommitAt: this.#lastCommitAt,
    };
  }
}
