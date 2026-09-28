import type { GoalGraphSnapshot, GoalManagerState, GoalTickResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { goals } from '@/database/schemas/goal';
import type { LobeChatDatabase } from '@/database/type';

import { scheduleGoalAdvance } from './scheduler';

export const goalWaitSchema = z.object({
  until: z.string().datetime(),
  event: z
    .object({ type: z.string().trim().min(1).max(255), key: z.string().trim().min(1).max(255) })
    .strict()
    .optional(),
});

export const goalWakeEventSchema = z
  .object({
    waitToken: z.string().min(1).max(255),
    eventId: z.string().trim().min(1).max(255),
    type: z.string().trim().min(1).max(255),
    key: z.string().trim().min(1).max(255),
    summary: z.string().max(2000).optional(),
    reference: z.string().max(2000).optional(),
  })
  .strict();

/** The Goal receipt owns waiting; queue messages only request another check. */
export class GoalWaitService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  // Bound queue delays; the sweep also recovers lost callbacks after the deadline.
  schedule = (goalId: string, until: string) =>
    scheduleGoalAdvance({
      goalId,
      userId: this.userId,
      workspaceId: this.workspaceId,
      trigger: 'wake',
      delay: Math.max(1, Math.min(86400, Math.ceil((Date.parse(until) - Date.now()) / 1000))),
    });

  private save = async (db: LobeChatDatabase, goalId: string, state: GoalManagerState) => {
    await db
      .update(goals)
      .set({
        config: sql`jsonb_set(COALESCE(${goals.config}, '{}'::jsonb), '{managerState}', ${JSON.stringify(state)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goalId));
  };

  advance = async (graph: GoalGraphSnapshot): Promise<GoalTickResult | null> => {
    const state = graph.goal.config?.managerState;
    const wait = state?.wait;
    if (!state?.consumed || !wait || wait.wake) return null;
    if (Date.parse(wait.until) > Date.now()) {
      await this.schedule(graph.goal.id, wait.until);
      return {
        goalId: graph.goal.id,
        outcome: 'waiting_external',
        message: `Waiting until ${wait.until}: ${state.submitted?.reason ?? ''}`,
      };
    }
    await this.db.transaction(async (db) => {
      const goal = await new GoalModel(db, this.userId, this.workspaceId).lockById(graph.goal.id);
      const current = goal?.config?.managerState;
      if (
        !goal ||
        !['planning', 'running'].includes(goal.status) ||
        current?.token !== state.token ||
        !current.consumed ||
        !current.wait ||
        current.wait.wake
      )
        return;
      const freshGraph = await new GoalGraphModel(db, this.userId, this.workspaceId).getGraph(
        goal.id,
      );
      if (freshGraph?.decisions.some((decision) => decision.status === 'pending')) return;
      await this.save(db, goal.id, {
        ...current,
        wait: { ...current.wait, wake: { at: new Date().toISOString(), cause: 'timer' } },
      });
    });
    return {
      goalId: graph.goal.id,
      outcome: 'advanced',
      message: 'Wait elapsed; reconsider the Goal using current evidence',
    };
  };

  /** First matching delivery wins; old turn tokens cannot wake subsequent waits. */
  deliver = async (goalId: string, input: z.infer<typeof goalWakeEventSchema>) => {
    const event = goalWakeEventSchema.parse(input);
    const result = await this.db.transaction(async (db) => {
      const goal = await new GoalModel(db, this.userId, this.workspaceId).lockById(goalId);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      const state = goal.config?.managerState;
      const wait = state?.wait;
      if (
        !state ||
        state.token !== event.waitToken ||
        !wait?.event ||
        wait.event.type !== event.type ||
        wait.event.key !== event.key
      )
        return { accepted: false, reason: 'unmatched' as const };
      if (wait.wake) return { accepted: false, reason: 'already_woken' as const };
      // A pause is not undone by a producer. Redeliver after explicit resume,
      // or rely on the fallback timer. This receipt is not a historical inbox.
      if (!['planning', 'running'].includes(goal.status))
        return { accepted: false, reason: 'stopped' as const };
      const graph = await new GoalGraphModel(db, this.userId, this.workspaceId).getGraph(goalId);
      if (graph?.decisions.some((decision) => decision.status === 'pending'))
        return { accepted: false, reason: 'human_gate' as const };
      await this.save(db, goalId, {
        ...state,
        wait: {
          ...wait,
          wake: {
            at: new Date().toISOString(),
            cause: 'event',
            eventId: event.eventId,
            reference: event.reference,
            summary: event.summary,
          },
        },
      });
      return { accepted: true };
    });
    if (result.accepted)
      await scheduleGoalAdvance({
        goalId,
        userId: this.userId,
        workspaceId: this.workspaceId,
        trigger: 'wake',
      });
    return result;
  };
}
