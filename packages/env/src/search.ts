import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getSearchConfig = () => {
  return createEnv({
    runtimeEnv: {
      ES_API_KEY: process.env.ES_API_KEY,
      ES_INCREMENTAL_SYNC_ENABLED: process.env.ES_INCREMENTAL_SYNC_ENABLED,
      ES_INDEX_NAMESPACE: process.env.ES_INDEX_NAMESPACE,
      ES_URL: process.env.ES_URL,
      SEARCH_BACKEND: process.env.SEARCH_BACKEND,
    },
    server: {
      ES_API_KEY: z.string().min(1).optional(),
      ES_INCREMENTAL_SYNC_ENABLED: z.enum(['true', 'false']).optional(),
      ES_INDEX_NAMESPACE: z.string().min(1).optional(),
      ES_URL: z.string().url().optional(),
      SEARCH_BACKEND: z.enum(['elasticsearch', 'pg_search']).default('pg_search'),
    },
  });
};

export const searchEnv = getSearchConfig();
