import { Hono } from 'hono';

import { MarketAccountModel } from '../../models/account';
import type { MarketHonoEnv } from '../../types';
import { trustedAuth } from '../auth';
import { getMarketDb } from '../context';
import { MarketHttpError } from '../errors';

export const createOidcRoutes = (): Hono<MarketHonoEnv> => {
  const app = new Hono<MarketHonoEnv>();

  app.get('/userinfo', trustedAuth(), async (c) => {
    const trustedPayload = c.get('trustedPayload');
    if (!trustedPayload) {
      throw new MarketHttpError(
        401,
        'missing_trusted_token',
        'A trusted client token is required.',
      );
    }

    const account = await new MarketAccountModel(getMarketDb(c)).upsertFromTrustedPayload(
      trustedPayload,
    );

    return c.json({
      accountId: account.id,
      email: account.email,
      name: account.displayName,
      picture: null,
      sub: trustedPayload.userId,
      userName: account.userName,
    });
  });

  return app;
};
