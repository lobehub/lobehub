import { and, eq, sql } from 'drizzle-orm';

import { goalSubscriptions } from '../schemas/goalSubscription';
import type { LobeChatDatabase } from '../type';

/** Subscription binding lifecycle; callers authorize and lock the owning Goal. */
export class GoalSubscriptionModel {
  constructor(private readonly db: LobeChatDatabase) {}

  /** Privileged primitive: call only after authorizing and locking the owning Goal. */
  disableForGoal = async (goalId: string) => {
    await this.db
      .update(goalSubscriptions)
      .set({
        enabled: false,
        bindingRevision: sql`${goalSubscriptions.bindingRevision} + 1`,
        cursor: sql`${goalSubscriptions.cursor} - 'pendingWake'`,
        updatedAt: new Date(),
      })
      .where(and(eq(goalSubscriptions.goalId, goalId), eq(goalSubscriptions.enabled, true)));
  };
}
