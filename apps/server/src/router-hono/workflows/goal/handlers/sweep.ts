import type { Context } from 'hono';

import { type GoalSweepPayload, sweepGoals } from '@/server/services/goal/sweep';

/**
 * QStash Schedule receiver for the goal safety-net sweep. The route is
 * signature-verified by `qstashAuth`; the sweep itself lives in `sweepGoals`
 * so the built-in scheduler can run it without HTTP.
 */
export async function sweep(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as GoalSweepPayload | null;
    return c.json(await sweepGoals(body ?? {}));
  } catch (error) {
    console.error('[goal/sweep] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
