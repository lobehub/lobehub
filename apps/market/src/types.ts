import type { MarketEnv } from './env';

export type MarketDatabase = Record<PropertyKey, unknown>;

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
