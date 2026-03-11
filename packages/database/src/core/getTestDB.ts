import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { Pool as NodePool } from 'pg';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';

const migrationsFolder = join(__dirname, '../../migrations');

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

let testClientDB: ReturnType<typeof pgliteDrizzle<typeof schema>> | null = null;
let testServerDB: ReturnType<typeof nodeDrizzle<typeof schema>> | null = null;

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (testServerDB) return testServerDB as unknown as LobeChatDatabase;

    const connectionString = serverDBEnv.DATABASE_TEST_URL;

    if (!connectionString) {
      throw new Error('DATABASE_TEST_URL is not set');
    }

    const client = new NodePool({ connectionString });
    testServerDB = nodeDrizzle(client, { schema });

    await nodeMigrate(testServerDB, { migrationsFolder });

    return testServerDB as unknown as LobeChatDatabase;
  }

  // Client DB mode (PGlite)
  if (testClientDB) return testClientDB as unknown as LobeChatDatabase;

  const pglite = new PGlite({ extensions: { vector } });
  testClientDB = pgliteDrizzle({ client: pglite, schema });

  // Custom migration that skips pg_search-related SQL for PGlite compatibility
  const migrations = readMigrationFiles({ migrationsFolder });

  await testClientDB.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await testClientDB.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const migration of migrations) {
    const skipSql = migration.sql.some(
      (s) => s.toLowerCase().includes('pg_search') || s.toLowerCase().includes('bm25'),
    );

    if (!skipSql) {
      for (const stmt of migration.sql) {
        await testClientDB.execute(sql.raw(stmt));
      }
    }

    await testClientDB.execute(
      sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
    );
  }

  return testClientDB as unknown as LobeChatDatabase;
};
