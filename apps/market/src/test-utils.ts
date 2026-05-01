import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';

import { createMarketApp } from './app';
import type { MarketDatabase } from './types';

interface DatabaseTestUtils {
  getTestDB: () => Promise<MarketDatabase>;
}

interface MarketTrustTokenOverrides {
  email: string;
  name: string;
  userId: string;
}

export const marketTestSecret = 'lobehub-market_tcs_test-secret-for-market-service';

export const marketTestEnv = {
  MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub',
  MARKET_TRUSTED_CLIENT_SECRET: marketTestSecret,
};

const loadDatabaseTestUtils = async (): Promise<DatabaseTestUtils> => {
  const moduleName = ['@lobechat/database', 'test-utils'].join('/');

  return await import(moduleName);
};

export const createMarketTrustToken = (overrides: Partial<MarketTrustTokenOverrides> = {}) =>
  createTrustedClientToken(
    buildTrustedClientPayload({
      clientId: marketTestEnv.MARKET_TRUSTED_CLIENT_ID,
      email: overrides.email ?? 'market-sdk@example.com',
      name: overrides.name ?? 'Market SDK User',
      userId: overrides.userId ?? 'market-sdk-user',
    }),
    marketTestSecret,
  );

export const createMarketTestFetch = async (): Promise<typeof fetch> => {
  const { getTestDB } = await loadDatabaseTestUtils();
  const db = await getTestDB();
  const app = createMarketApp({ db, env: marketTestEnv });

  return async (input, init) => {
    const inputRequest = input instanceof Request ? input : undefined;
    const requestUrl = new URL(inputRequest ? inputRequest.url : input.toString());
    const requestInit: RequestInit = {
      body: inputRequest ? await inputRequest.clone().arrayBuffer() : undefined,
      headers: inputRequest?.headers,
      method: inputRequest?.method,
      ...init,
    };

    return await app.request(`${requestUrl.pathname}${requestUrl.search}`, requestInit);
  };
};
