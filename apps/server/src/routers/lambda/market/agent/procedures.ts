import debug from 'debug';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { UserModel } from '@/database/models/user';
import { authedProcedure } from '@/libs/trpc/lambda';
import { marketSDK, marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';

const log = debug('lambda-router:market:agent');

export const MARKET_BASE_URL = process.env.MARKET_BASE_URL || 'https://market.lobehub.com';

// Authenticated procedure for agent management
// Requires user to be logged in and has MarketSDK initialized
// Also fetches user's market accessToken from database for OIDC authentication
export const agentProcedure = authedProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(marketSDK)
  .use(async ({ ctx, next }) => {
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

    // Get user's market accessToken from database (stored by MarketAuthProvider after OIDC login)
    let marketOidcAccessToken: string | undefined;
    try {
      const userState = await userModel.getUserState(async () => ({}));
      marketOidcAccessToken = userState.settings?.market?.accessToken;
      log('marketOidcAccessToken from DB exists=%s', !!marketOidcAccessToken);
    } catch (error) {
      log('Failed to get marketOidcAccessToken from DB: %O', error);
    }

    return next({
      ctx: {
        marketOidcAccessToken,
      },
    });
  });

export const agentWriteProcedure = agentProcedure.use(withScopedPermission('agent:create'));
