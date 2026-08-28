import type { GoalAdvanceTrigger } from '@lobechat/agent-tracing';
import type { GoalTickOutcome, GoalTickResult } from '@lobechat/types';
import debug from 'debug';

import { getServerDB } from '@/database/server';

import { GoalAdvanceRecorder, TERMINAL_GOAL_STATUSES } from './goalTraceRecorder';
import { GoalService } from './index';

const log = debug('lobe-server:goal-advance');

/**
 * Outcomes the coordinator cannot get past by ticking again.
 *
 * `waiting_external` is one of them here, and that is the whole point of the
 * event-driven design: it means a Work Task is now executing, so the next move
 * belongs to that task's completion, not to a poll loop holding a worker open.
 */
const STOP_OUTCOMES = new Set<GoalTickOutcome>([
  'achieved',
  'failed',
  'no_progress',
  'waiting_external',
  'waiting_human',
]);

/**
 * Safety limit for one advance. Dispatching a Work takes two ticks, so a
 * healthy run is a handful; anything near this is a loop that is not
 * converging, and the sweep will come back to it.
 */
export const MAX_TICKS_PER_ADVANCE = 20;

export interface AdvanceGoalParams {
  goalId: string;
  /** What caused this advance. Recorded on the trajectory so a run can be sliced by source. */
  trigger?: GoalAdvanceTrigger;
  userId: string;
  workspaceId?: string;
}

export interface AdvanceGoalOutcome {
  goalId: string;
  result: GoalTickResult;
  ticks: number;
}

/**
 * Advance a goal until it is waiting on something that is not another tick.
 *
 * This is the server-side driver: a goal moves because something happened to
 * it, not because a client is holding a loop open. Runs as the goal's own
 * owner, so it sees exactly what that user's coordinator would see.
 */
export const advanceGoal = async ({
  goalId,
  trigger = 'unknown',
  userId,
  workspaceId,
}: AdvanceGoalParams): Promise<AdvanceGoalOutcome> => {
  const db = await getServerDB();
  const service = new GoalService(db, userId, workspaceId);
  const recorder = new GoalAdvanceRecorder(db, goalId, trigger);

  let result: GoalTickResult | undefined;
  try {
    for (let ticks = 1; ticks <= MAX_TICKS_PER_ADVANCE; ticks++) {
      result = await service.tick(goalId, { onDecision: recorder.onDecision });
      log('goal %s tick %d → %s (%s)', goalId, ticks, result.outcome, result.message);
      if (STOP_OUTCOMES.has(result.outcome)) {
        await settleTrace(recorder, service, goalId);
        return { goalId, result, ticks };
      }
    }
  } catch (error) {
    // Record what the advance managed to do before it threw. A trajectory that
    // stops mid-advance with the failure attached is the whole point of keeping
    // one — losing it is exactly the blind spot this replaces.
    await recorder.flush(error);
    throw error;
  }

  log('goal %s hit the per-advance tick limit', goalId);
  await settleTrace(recorder, service, goalId);
  return { goalId, result: result!, ticks: MAX_TICKS_PER_ADVANCE };
};

/**
 * Write the advance, then close the trajectory if the goal itself is done.
 *
 * The status is re-read rather than inferred from the outcome: `failed` is
 * reported both by a goal that is genuinely over and by a tick that could not
 * find a responsible task, and only the first should finalize.
 */
const settleTrace = async (
  recorder: GoalAdvanceRecorder,
  service: GoalService,
  goalId: string,
): Promise<void> => {
  await recorder.flush();
  if (!recorder.enabled) return;

  const status = await service.status(goalId).catch(() => undefined);
  if (status && TERMINAL_GOAL_STATUSES.has(status)) await recorder.finalize(status);
};
