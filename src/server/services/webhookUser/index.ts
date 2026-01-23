import { type LobeChatDatabase } from '@lobechat/database';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { UserModel } from '@/database/models/user';
import { type UserItem, account, session } from '@/database/schemas';
import { pino } from '@/libs/logger';

export class WebhookUserService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Find user by provider account info
   */
  private getUserByAccount = async ({
    providerId,
    accountId,
  }: {
    accountId: string;
    providerId: string;
  }) => {
    const result = await this.db.query.account.findFirst({
      where: and(eq(account.providerId, providerId), eq(account.accountId, accountId)),
    });

    if (!result) return null;

    return this.db.query.users.findFirst({
      where: eq(account.userId, result.userId),
    });
  };

  /**
   * Safely update user data from webhook
   */
  safeUpdateUser = async (
    { accountId, providerId }: { accountId: string; providerId: string },
    data: Partial<UserItem>,
  ) => {
    pino.info(`updating user "${JSON.stringify({ accountId, providerId })}" due to webhook`);

    const user = await this.getUserByAccount({ accountId, providerId });

    if (user?.id) {
      const userModel = new UserModel(this.db, user.id);
      await userModel.updateUser({
        avatar: data?.avatar,
        email: data?.email,
        fullName: data?.fullName,
      });
    } else {
      pino.warn(
        `[${providerId}]: Webhook user "${JSON.stringify({ accountId, providerId })}" update for "${JSON.stringify(data)}", but no user was found.`,
      );
    }

    return NextResponse.json({ message: 'user updated', success: true }, { status: 200 });
  };

  /**
   * Safely sign out user (delete all sessions)
   */
  safeSignOutUser = async ({
    accountId,
    providerId,
  }: {
    accountId: string;
    providerId: string;
  }) => {
    pino.info(`Signing out user "${JSON.stringify({ accountId, providerId })}"`);

    const user = await this.getUserByAccount({ accountId, providerId });

    if (user?.id) {
      await this.db.delete(session).where(eq(session.userId, user.id));
    } else {
      pino.warn(
        `[${providerId}]: Webhook user "${JSON.stringify({ accountId, providerId })}" signout, but no user was found.`,
      );
    }

    return NextResponse.json({ message: 'user signed out', success: true }, { status: 200 });
  };
}
