import { type LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import { type TrustedClientUserInfo } from '@/libs/trusted-client';

import { trpc } from '../init';

interface ContextWithServerDB {
  marketAccessToken?: string;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
  workspaceId?: string | null;
}

interface MarketUserContext {
  marketAccessToken?: string;
  marketUserInfo?: TrustedClientUserInfo;
}

export const resolveMarketUserContext = async (
  ctx: ContextWithServerDB,
): Promise<MarketUserContext> => {
  // If userId or serverDB is not available, skip fetching user info
  if (!ctx.userId || !ctx.serverDB) return { marketUserInfo: undefined };

  try {
    const user = await UserModel.findById(ctx.serverDB, ctx.userId);

    if (!user || !user.email) return { marketUserInfo: undefined };

    const marketUserInfo: TrustedClientUserInfo = {
      email: user.email,
      name: user.fullName || user.username || undefined,
      userId: ctx.userId,
      // In a workspace context, the token acts as the workspace's mirrored
      // organization; absent for personal requests.
      ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    };

    // Fetch market access token from user_settings.market
    const userModel = new UserModel(ctx.serverDB, ctx.userId);
    const userSettings = await userModel.getUserSettings();
    const marketTokenFromDB = (userSettings?.market as any)?.accessToken;

    return {
      // Prioritize database token over cookie token
      marketAccessToken: marketTokenFromDB || ctx.marketAccessToken,
      marketUserInfo,
    };
  } catch {
    // If fetching user info fails, continue without it
    return { marketUserInfo: undefined };
  }
};

/**
 * Middleware that fetches user info for Market trusted client authentication
 * This requires serverDatabase middleware to be applied first
 */
export const marketUserInfo = trpc.middleware(async (opts) => {
  const ctx = opts.ctx as ContextWithServerDB;
  const marketContext = await resolveMarketUserContext(ctx);

  return opts.next({ ctx: marketContext });
});
