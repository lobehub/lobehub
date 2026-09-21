import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getElasticsearchFtsSearchConfig = () => {
  return createEnv({
    runtimeEnv: {
      ES_ALLOW_INSECURE_HTTP: process.env.ES_ALLOW_INSECURE_HTTP,
      ES_API_KEY: process.env.ES_API_KEY,
      FTS_SEARCH_SYNC_ENABLED: process.env.FTS_SEARCH_SYNC_ENABLED,
      ES_INDEX_NAMESPACE: process.env.ES_INDEX_NAMESPACE,
      ES_URL: process.env.ES_URL,
    },
    server: {
      /**
       * Explicit opt-in for an Elasticsearch node on a private container network that runs with
       * security disabled: allows plaintext `http://` to a non-loopback host and lets `ES_API_KEY`
       * be omitted. An API key is still never sent over plaintext HTTP.
       */
      ES_ALLOW_INSECURE_HTTP: z.enum(['true', 'false']).optional(),
      ES_API_KEY: z.string().min(1).optional(),
      FTS_SEARCH_SYNC_ENABLED: z.enum(['true', 'false']).optional(),
      ES_INDEX_NAMESPACE: z.string().min(1).optional(),
      ES_URL: z.string().url().optional(),
    },
  });
};

/**
 * Deployment-selected full-text search implementation.
 *
 * - `pg_search`: ParadeDB BM25 (self-host default).
 * - `elasticsearch`: managed Elasticsearch cluster.
 * - `pg_like`: extension-free PostgreSQL `ILIKE` matching for lightweight deployments;
 *   an explicit choice, never an implicit fallback for a missing extension.
 */
export const FTS_SEARCH_PROVIDER_VALUES = ['elasticsearch', 'pg_search', 'pg_like'] as const;

export type FtsSearchProviderName = (typeof FTS_SEARCH_PROVIDER_VALUES)[number];

export interface FtsSearchConfigOptions {
  /** Provider used when `FTS_SEARCH_PROVIDER` is unset; distributions override it. */
  defaultProvider?: FtsSearchProviderName;
}

export const getFtsSearchConfig = ({
  defaultProvider = 'pg_search',
}: FtsSearchConfigOptions = {}) => {
  const providerConfig = createEnv({
    runtimeEnv: {
      FTS_SEARCH_PROVIDER: process.env.FTS_SEARCH_PROVIDER,
    },
    server: {
      FTS_SEARCH_PROVIDER: z.enum(FTS_SEARCH_PROVIDER_VALUES).default(defaultProvider),
    },
  });

  return { ...getElasticsearchFtsSearchConfig(), ...providerConfig };
};

export const ftsSearchEnv = getFtsSearchConfig();
