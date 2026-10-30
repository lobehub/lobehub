import { GoalModel } from '../../models/goal';
import { GoalSubscriptionModel } from '../../models/goalSubscription';
import type { LobeChatDatabase } from '../../type';

/** Goal operations with atomic lifecycle fencing of the separate subscription aggregate. */
export class GoalRepository extends GoalModel {
  constructor(
    private readonly database: LobeChatDatabase,
    private readonly ownerId: string,
    private readonly scope?: string,
  ) {
    super(database, ownerId, scope);
  }

  override update = async (...args: Parameters<GoalModel['update']>) =>
    this.database.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const row = await new GoalModel(db, this.ownerId, this.scope).update(...args);
      // Goal update holds the root lock before subscriptions, matching consumption.
      if (row && ['paused', 'canceled', 'achieved', 'failed'].includes(row.status)) {
        await new GoalSubscriptionModel(db).disableForGoal(row.id);
      }
      return row;
    });
}
