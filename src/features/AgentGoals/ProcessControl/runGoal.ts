import type { GoalTickResult } from '@lobechat/types';

/**
 * Outcomes the coordinator cannot move past on its own: the goal is done, it
 * needs a human, or nothing is ready. Mirrors the CLI's `lh goal run`.
 */
const TERMINAL_OUTCOMES = new Set(['achieved', 'failed', 'no_progress', 'waiting_human']);

/** Safety limit for one press. A goal that needs more than this needs a decision, not a longer loop. */
export const MAX_TICKS_PER_RUN = 100;

/** How long to wait while a dispatched task is executing before ticking again. */
export const RUN_POLL_MS = 3000;

export interface RunGoalDeps {
  /** Called after every tick so the surface can follow along. */
  onProgress?: (result: GoalTickResult, ticks: number) => void;
  sleep: (ms: number) => Promise<void>;
  tick: () => Promise<GoalTickResult>;
}

/**
 * Advance a goal until it stops on its own.
 *
 * One tick is a coordinator step, not a unit a person cares about: a single
 * press should carry the goal as far as it can go and stop exactly where the
 * user is needed. `waiting_external` means a dispatched task is still running,
 * so the loop waits and ticks again rather than reporting it as a stop.
 */
export const runGoal = async ({
  onProgress,
  sleep,
  tick,
}: RunGoalDeps): Promise<{ result: GoalTickResult; ticks: number }> => {
  let last: GoalTickResult | undefined;

  for (let ticks = 1; ticks <= MAX_TICKS_PER_RUN; ticks++) {
    last = await tick();
    onProgress?.(last, ticks);
    if (TERMINAL_OUTCOMES.has(last.outcome)) return { result: last, ticks };
    if (last.outcome === 'waiting_external') await sleep(RUN_POLL_MS);
  }

  return { result: last!, ticks: MAX_TICKS_PER_RUN };
};
