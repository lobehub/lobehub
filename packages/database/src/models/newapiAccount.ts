import { eq } from 'drizzle-orm';

import { userNewApiAccounts } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class NewApiAccountModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  find = async () => {
    return this.db.query.userNewApiAccounts.findFirst({
      where: eq(userNewApiAccounts.userId, this.userId),
    });
  };

  markPending = async () => {
    return this.db
      .insert(userNewApiAccounts)
      .values({
        lastProvisionError: null,
        status: 'pending',
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          lastProvisionError: null,
          status: 'pending',
          updatedAt: new Date(),
        },
        target: userNewApiAccounts.userId,
      });
  };

  markActive = async (newapiUserId: string) => {
    const now = new Date();

    return this.db
      .insert(userNewApiAccounts)
      .values({
        lastProvisionError: null,
        lastProvisionedAt: now,
        newapiUserId,
        status: 'active',
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          lastProvisionError: null,
          lastProvisionedAt: now,
          newapiUserId,
          status: 'active',
          updatedAt: now,
        },
        target: userNewApiAccounts.userId,
      });
  };

  markFailed = async (error: string) => {
    return this.db
      .insert(userNewApiAccounts)
      .values({
        lastProvisionError: error,
        status: 'failed',
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          lastProvisionError: error,
          status: 'failed',
          updatedAt: new Date(),
        },
        target: userNewApiAccounts.userId,
      });
  };
}
