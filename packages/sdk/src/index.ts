import type { Config } from './generated/client';
import { createClient, createConfig } from './generated/client';
import { LobeHub } from './generated/sdk.gen';

export const DEFAULT_BASE_URL = 'https://app.lobehub.com';

export interface LobeHubOptions extends Omit<Config, 'auth' | 'baseUrl'> {
  /** LobeHub API Key (`sk-lh-...`) or an OIDC JWT */
  apiKey: string;
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
  const { apiKey, baseURL = DEFAULT_BASE_URL, ...clientConfig } = options;
  const config: Config = { ...clientConfig, auth: () => apiKey, baseUrl: baseURL };

  return new LobeHub({ client: createClient(createConfig(config)) });
};

export type { Client, Config } from './generated/client';
export { LobeHub } from './generated/sdk.gen';
export type * from './generated/types.gen';
