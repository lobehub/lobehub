import { eq } from 'drizzle-orm';

import { goalTraces, type NewGoalTrace } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * The observation row for a goal.
 *
 * Written from the trajectory rather than accumulated as the goal runs: every
 * value here is derived from the recorded advances, so re-deriving it is exact
 * however many times it runs — the same reason `recordCompletion` re-sums child
 * operations instead of adding to a counter.
 */
export class GoalTraceModel {
  constructor(private readonly db: LobeChatDatabase) {}

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

  findById = async (goalId: string) => {
    const [row] = await this.db
      .select()
      .from(goalTraces)
      .where(eq(goalTraces.goalId, goalId))
      .limit(1);
    return row;
  };
}
