import { and, desc, eq } from 'drizzle-orm';

import { goals, goalTraces, type NewGoalTrace } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * The observation row for a goal.
 *
 * Written from the trajectory rather than accumulated as the goal runs: every
 * value here is derived from the recorded advances, so re-deriving it is exact
 * however many times it runs — the same reason `recordCompletion` re-sums child
 * operations instead of adding to a counter.
 *
 * Reads join `goals` for ownership. The row has no `user_id` of its own on
 * purpose: it is 1:1 with a goal, so a copy would be a second place for the
 * answer to drift.
 */
export class GoalTraceModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId?: string,
    private readonly workspaceId?: string,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId!, workspaceId: this.workspaceId }, goals);

  /** Upsert; an advance rewrites the whole row from the trajectory it just extended. */
  upsert = async (value: NewGoalTrace) => {
    const [row] = await this.db
      .insert(goalTraces)
      .values(value)
      .onConflictDoUpdate({
        set: { ...value, updatedAt: new Date() },
        target: goalTraces.goalId,
      })
      .returning();
    return row;
  };

  /** Ownership-scoped: another user's goal reads as absent, never as forbidden. */
  findById = async (goalId: string) => {
    const [row] = await this.db
      .select({ goal: goals, trace: goalTraces })
      .from(goalTraces)
      .innerJoin(goals, eq(goalTraces.goalId, goals.id))
      .where(and(eq(goalTraces.goalId, goalId), this.ownership()))
      .limit(1);
    return row ? { ...row.trace, title: row.goal.title } : undefined;
  };

  /** Goals that recorded a trajectory, newest run first. */
  list = async (limit = 20) => {
    const rows = await this.db
      .select({ goal: goals, trace: goalTraces })
      .from(goalTraces)
      .innerJoin(goals, eq(goalTraces.goalId, goals.id))
      .where(this.ownership())
      .orderBy(desc(goalTraces.startedAt))
      .limit(limit);

    return rows.map(({ goal, trace }) => ({ ...trace, title: goal.title }));
  };
}
