import type { GoalTickOutcome, GoalTickResult } from '@lobechat/types';
import debug from 'debug';

import { getServerDB } from '@/database/server';

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
  userId,
  workspaceId,
}: AdvanceGoalParams): Promise<AdvanceGoalOutcome> => {
  const db = await getServerDB();
  const service = new GoalService(db, userId, workspaceId);

  let result: GoalTickResult | undefined;
  for (let ticks = 1; ticks <= MAX_TICKS_PER_ADVANCE; ticks++) {
    result = await service.tick(goalId);
    log('goal %s tick %d → %s (%s)', goalId, ticks, result.outcome, result.message);
    if (STOP_OUTCOMES.has(result.outcome)) return { goalId, result, ticks };
  }

  log('goal %s hit the per-advance tick limit', goalId);
  return { goalId, result: result!, ticks: MAX_TICKS_PER_ADVANCE };
};
