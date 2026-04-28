import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type * as schema from '../../../packages/database/src/schemas/market';
import type { MarketEnv } from './env';

export type MarketDatabase = Pick<
  NodePgDatabase<typeof schema>,
  'delete' | 'insert' | 'select' | 'update'
>;

export interface TrustedClientPayload {
  clientId: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  nonce: string;
  timestamp: number;
  userId: string;
}

export interface MarketAuthVariables {
  db?: MarketDatabase;
  marketEnv?: Pick<MarketEnv, 'MARKET_TRUSTED_CLIENT_ID' | 'MARKET_TRUSTED_CLIENT_SECRET'>;
  trustedPayload?: TrustedClientPayload;
}

export type MarketHonoEnv = {
  Variables: MarketAuthVariables;
};
