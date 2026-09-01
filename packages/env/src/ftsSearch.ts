import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getFtsSearchConfig = () => {
  return createEnv({
    runtimeEnv: {
      ES_API_KEY: process.env.ES_API_KEY,
      FTS_SEARCH_SYNC_ENABLED: process.env.FTS_SEARCH_SYNC_ENABLED,
      ES_INDEX_NAMESPACE: process.env.ES_INDEX_NAMESPACE,
      ES_URL: process.env.ES_URL,
      FTS_SEARCH_PROVIDER: process.env.FTS_SEARCH_PROVIDER,
    },
    server: {
      ES_API_KEY: z.string().min(1).optional(),
      FTS_SEARCH_SYNC_ENABLED: z.enum(['true', 'false']).optional(),
      ES_INDEX_NAMESPACE: z.string().min(1).optional(),
      ES_URL: z.string().url().optional(),
      FTS_SEARCH_PROVIDER: z.enum(['elasticsearch', 'pg_search']).default('pg_search'),
    },
  });
};

export const ftsSearchEnv = getFtsSearchConfig();
