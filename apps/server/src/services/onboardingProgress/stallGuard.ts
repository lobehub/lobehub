import type {
  OnboardingGenerationProgressPhase,
  OnboardingGenerationProgressStalledReason,
} from '@lobechat/types';

type ActiveProgressPhase = Exclude<
  OnboardingGenerationProgressPhase,
  'completed' | 'failed' | 'partial' | 'stalled'
>;

/**
 * Longest a single progress stream may stay open. The platform kills the function at 300s, and
 * that cut is what makes EventSource reconnect, so the stream ends itself with a 30s margin.
 */
export const ONBOARDING_PROGRESS_STREAM_BUDGET_MS = 270_000;

/** How often a Redis-backed stream re-reads persisted state to recover a missed notification. */
export const ONBOARDING_PROGRESS_RECONCILE_INTERVAL_MS = 15_000;

/**
 * How long each phase may go without a persisted change before the stream stops waiting.
 *
 * LLM phases write nothing until a generation finishes, so they get the longest windows. Ending a
 * stream does not fail the session: clients keep reading persisted state through polling, so a
 * slow generation that outlives its window still reaches its result.
 */
export const ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS: Record<ActiveProgressPhase, number> = {
  'collecting-sources': 120_000,
  'generating-detailed-persona': 210_000,
  'generating-understanding': 210_000,
  'recommending-tasks': 150_000,
};

const DEFAULT_STALL_THRESHOLD_MS = Math.min(
  ...Object.values(ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS),
);

const stallThreshold = (phase: OnboardingGenerationProgressPhase) =>
  ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS[phase as ActiveProgressPhase] ??
  DEFAULT_STALL_THRESHOLD_MS;

/**
 * Tracks when a progress stream last saw a persisted change.
 *
 * Use when:
 * - Bounding either wait path of the onboarding progress subscription
 *
 * Expects:
 * - `recordProgress` is called only when the persisted event ID changes
 *
 * Returns:
 * - The time left in the current phase, and why the stream expired once it has
 */
export const createOnboardingProgressStallGuard = (startedAt: number) => {
  let lastProgressAt = startedAt;
  const budgetEndsAt = startedAt + ONBOARDING_PROGRESS_STREAM_BUDGET_MS;
  const stallsAt = (phase: OnboardingGenerationProgressPhase) =>
    lastProgressAt + stallThreshold(phase);

  return {
    expiredReason: (
      phase: OnboardingGenerationProgressPhase,
      now: number,
    ): OnboardingGenerationProgressStalledReason | undefined => {
      if (now >= stallsAt(phase)) return 'no-progress';
      if (now >= budgetEndsAt) return 'stream-budget';
      return undefined;
    },
    recordProgress: (now: number) => {
      lastProgressAt = now;
    },
    remainingMs: (phase: OnboardingGenerationProgressPhase, now: number) =>
      Math.max(0, Math.min(stallsAt(phase), budgetEndsAt) - now),
  };
};
