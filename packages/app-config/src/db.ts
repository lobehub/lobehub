import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getServerDBConfig = () => {
  return createEnv({
    runtimeEnv: {
      DATABASE_DRIVER: process.env.DATABASE_DRIVER || 'neon',
      DATABASE_POOL_ACQUIRE_TIMEOUT: process.env.DATABASE_POOL_ACQUIRE_TIMEOUT,
      DATABASE_STATEMENT_TIMEOUT: process.env.DATABASE_STATEMENT_TIMEOUT,
      DATABASE_TEST_URL: process.env.DATABASE_TEST_URL,
      DATABASE_URL: process.env.DATABASE_URL,

      KEY_VAULTS_FALLBACK_SECRET: process.env.KEY_VAULTS_FALLBACK_SECRET,
      KEY_VAULTS_SECRET: process.env.KEY_VAULTS_SECRET,

      REMOVE_GLOBAL_FILE: process.env.DISABLE_REMOVE_GLOBAL_FILE !== '0',
    },
    server: {
      DATABASE_DRIVER: z.enum(['neon', 'node']),
      // How long (in milliseconds) a query waits for a free pool connection before it fails.
      // Without a limit a request whose pool is exhausted waits forever, and every other request
      // on the same instance queues behind it. Defaults to 30s; set 0 to wait indefinitely.
      DATABASE_POOL_ACQUIRE_TIMEOUT: z.coerce.number().int().min(0).optional(),
      // Server-side timeout (in milliseconds) for a single SQL statement.
      // When set, Postgres aborts any statement running longer than this,
      // preventing a stuck query (e.g. lock contention) from blocking indefinitely.
      // Leave unset to keep Postgres' default of no timeout.
      DATABASE_STATEMENT_TIMEOUT: z.coerce.number().optional(),
      DATABASE_TEST_URL: z.string().optional(),
      DATABASE_URL: z.string().optional(),

      KEY_VAULTS_FALLBACK_SECRET: z.string().optional(),
      KEY_VAULTS_SECRET: z.string().optional(),

      REMOVE_GLOBAL_FILE: z.boolean().optional(),
    },
  });
};

export const serverDBEnv = getServerDBConfig();
