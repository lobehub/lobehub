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
  const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
  const admin = new NodePool({ connectionString, max: 1 });
  let extensions: string[];
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${quote(name)}`);
    // A new database only gets the extensions of template1. Mirror the base
    // database's (pg_search, vector, …): migrations skip the BM25 indexes when
    // pg_search is missing, and the FTS tests then fail.
    const { rows } = await admin.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'",
    );
    extensions = rows.map((row) => row.extname);
  } finally {
    await admin.end();
  }

  url.pathname = `/${encodeURIComponent(name)}`;
  const worker = new NodePool({ connectionString: url.toString(), max: 1 });
  try {
    for (const extension of extensions) {
      // Best effort: some (pg_cron) can only live in one database per server.
      await worker.query(`CREATE EXTENSION IF NOT EXISTS ${quote(extension)}`).catch(() => {});
    }
  } finally {
    await worker.end();
  }
  return url.toString();
};

let testDatabaseUrl: Promise<string> | undefined;

/**
 * The server-DB connection string this worker's tests use: `DATABASE_TEST_URL`,
 * or the worker's own database when `DATABASE_TEST_WORKERS` is above 1. Tests
 * that open their own connection must use this, not the variable.
 */
export const getTestDatabaseUrl = (): Promise<string> => {
  const connectionString = serverDBEnv.DATABASE_TEST_URL;
  if (!connectionString) throw new Error('DATABASE_TEST_URL is not set');
  testDatabaseUrl ??= workerDatabaseUrl(connectionString);
  return testDatabaseUrl;
};

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (testServerDB) return testServerDB as unknown as LobeChatDatabase;

    const connectionString = await getTestDatabaseUrl();
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
