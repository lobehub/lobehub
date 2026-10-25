import { DEFAULT_BASE_URL } from './constants';
import type { Config } from './generated/client';
import { createClient, createConfig } from './generated/client';
import { LobeHub } from './generated/sdk.gen';

export { DEFAULT_BASE_URL } from './constants';

export interface LobeHubOptions extends Omit<Config, 'auth' | 'baseUrl'> {
  /**
   * Called before every request for the OIDC access token to send. Refresh it
   * here (see `refreshAccessToken`) so long-lived clients never send an expired
   * one. Takes precedence over `apiKey`.
   */
  accessToken?: () => Promise<string> | string;
  /** LobeHub API Key (`sk-lh-...`) or an OIDC JWT */
  apiKey?: string;
  /** API origin, defaults to LobeHub Cloud (`https://app.lobehub.com`) */
  baseURL?: string;
}

/**
 * Create a resource-style LobeHub API client: `lobehub.agents.list()`,
 * `lobehub.files.uploadBatch()`, `lobehub.users.me()`, …
 *
 * Resources, methods, and schemas are generated from
 * `packages/openapi/openapi.yml` — run `bun generate` after the spec changes.
 */
export const createLobeHub = (options: LobeHubOptions): LobeHub => {
  const { accessToken, apiKey, baseURL = DEFAULT_BASE_URL, ...clientConfig } = options;
  if (!accessToken && !apiKey)
    throw new Error('createLobeHub needs an apiKey or an accessToken provider');

  const config: Config = {
    ...clientConfig,
    auth: accessToken ? () => accessToken() : () => apiKey,
    baseUrl: baseURL,
  };

  return new LobeHub({ client: createClient(createConfig(config)) });
};

export * from './auth';
export type { Client, Config } from './generated/client';
export { LobeHub } from './generated/sdk.gen';
export type * from './generated/types.gen';
