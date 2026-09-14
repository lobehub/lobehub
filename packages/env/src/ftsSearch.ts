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

export const getFtsSearchConfig = () => {
  const providerConfig = createEnv({
    runtimeEnv: {
      FTS_SEARCH_PROVIDER: process.env.FTS_SEARCH_PROVIDER,
    },
    server: {
      FTS_SEARCH_PROVIDER: z.enum(['elasticsearch', 'pg_search']).default('pg_search'),
    },
  });

  return { ...getElasticsearchFtsSearchConfig(), ...providerConfig };
};

export const ftsSearchEnv = getFtsSearchConfig();
