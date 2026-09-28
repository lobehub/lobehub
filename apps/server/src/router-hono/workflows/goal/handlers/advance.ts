import type { GoalAdvanceTrigger } from '@lobechat/agent-tracing';
import debug from 'debug';
import type { Context } from 'hono';

import { advanceGoal } from '@/server/services/goal/advanceGoal';

const log = debug('lobe-server:workflows:goal:advance');

export interface GoalAdvancePayload {
  goalId?: string;
  trigger?: GoalAdvanceTrigger;
  userId?: string;
  workspaceId?: string;
}

/**
 * Advance one goal. Queued whenever something may have unblocked it — it was
 * created, a decision gate was resolved, a budget was raised, or one of its
 * Work Tasks settled.
 *
 * No per-user authentication: the payload carries the goal's own owner, and the
 * route is signature-verified by the `qstashAuth` middleware. The handler
 * re-reads the goal, so a message that lands after the user paused it, or after
 * it finished, is a no-op.
 */
export async function advance(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as GoalAdvancePayload;
    const { goalId, trigger, userId, workspaceId } = body ?? {};

    if (!goalId || !userId) {
      return c.json({ error: 'goalId and userId are required', success: false }, 400);
    }

    const outcome = await advanceGoal({ goalId, trigger, userId, workspaceId });
    log('goal %s advanced in %d tick(s) → %s', goalId, outcome.ticks, outcome.result.outcome);

    return c.json({
      goalId,
      message: outcome.result.message,
      outcome: outcome.result.outcome,
      success: true,
      ticks: outcome.ticks,
    });
  } catch (error) {
    console.error('[goal/advance] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
