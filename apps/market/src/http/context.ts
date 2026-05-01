import type { Context } from 'hono';

import type { MarketHonoEnv } from '../types';
import { MarketHttpError } from './errors';

export const getMarketDb = (c: Context<MarketHonoEnv>) => {
  const db = c.get('db');
  if (!db)
    throw new MarketHttpError(
      500,
      'market_db_not_configured',
      'Market database is not configured.',
    );
  return db;
};

export const getMarketEnv = (c: Context<MarketHonoEnv>) => {
  const env = c.get('marketEnv');
  if (!env)
    throw new MarketHttpError(
      500,
      'market_env_not_configured',
      'Market environment is not configured.',
    );
  return env;
};
