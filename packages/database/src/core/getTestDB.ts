import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { migrate as pgliteMigrate } from 'drizzle-orm/pglite/migrator';
import { Pool as NodePool } from 'pg';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createPGlite, migrationsFolder, readPGliteSnapshot } from './pgliteSnapshot';

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

let testClientDB: ReturnType<typeof pgliteDrizzle<typeof schema>> | null = null;
let testServerDB: ReturnType<typeof nodeDrizzle<typeof schema>> | null = null;

/**
 * Server-DB tests share one database, so they run in a single worker. With
 * `DATABASE_TEST_WORKERS` above 1, each Vitest worker gets its own database
 * (`<name>_w<VITEST_POOL_ID>`, created on first use and migrated by the caller)
 * and the files run in parallel without seeing each other's rows.
 */
const workerDatabaseUrl = async (connectionString: string) => {
  const workerId = process.env.VITEST_POOL_ID;
  if (!(Number(process.env.DATABASE_TEST_WORKERS) > 1) || !workerId) return connectionString;

  const url = new URL(connectionString);
  const name = `${decodeURIComponent(url.pathname.slice(1)) || 'postgres'}_w${workerId}`;
  const admin = new NodePool({ connectionString, max: 1 });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
};

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (testServerDB) return testServerDB as unknown as LobeChatDatabase;

    const baseConnectionString = serverDBEnv.DATABASE_TEST_URL;

    if (!baseConnectionString) {
      throw new Error('DATABASE_TEST_URL is not set');
    }

    const connectionString = await workerDatabaseUrl(baseConnectionString);
    const client = new NodePool({ connectionString });
    testServerDB = nodeDrizzle(client, { schema });

    await nodeMigrate(testServerDB, { migrationsFolder });

    return testServerDB as unknown as LobeChatDatabase;
  }

  // Client DB mode (PGlite)
  if (testClientDB) return testClientDB as unknown as LobeChatDatabase;

  const snapshot = readPGliteSnapshot();
  const pglite = createPGlite(snapshot);
  testClientDB = pgliteDrizzle({ client: pglite, schema });

  // The global setup's snapshot is already migrated; without it, migrate here.
  // pg_search migrations skip themselves when the extension is unavailable, as in PGlite.
  if (!snapshot) await pgliteMigrate(testClientDB, { migrationsFolder });

  return testClientDB as unknown as LobeChatDatabase;
};
