import type { LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import type { TrustedClientUserInfo } from '@/libs/trusted-client';

import { trpc } from '../init';

interface ContextWithServerDB {
  serverDB?: LobeChatDatabase;
  userId?: string | null;
}

/**
 * Middleware that fetches user info for Market trusted client authentication
 * This requires serverDatabase middleware to be applied first
 */
export const marketUserInfo = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithServerDB;

  // If userId or serverDB is not available, skip fetching user info
  if (!ctx.userId || !ctx.serverDB) {
    return opts.next({
      ctx: { marketUserInfo: undefined },
    });
  }

  try {
    const user = await UserModel.findById(ctx.serverDB, ctx.userId);

    if (!user || !user.email) {
      return opts.next({
        ctx: { marketUserInfo: undefined },
      });
    }

    const marketUserInfo: TrustedClientUserInfo = {
      email: user.email,
      name: user.fullName || user.username || undefined,
      userId: ctx.userId,
    };

    return opts.next({
      ctx: { marketUserInfo },
    });
  } catch {
    // If fetching user info fails, continue without it
    return opts.next({
      ctx: { marketUserInfo: undefined },
    });
  }
});
