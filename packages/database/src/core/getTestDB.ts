import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
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

/**
 * Run migrations manually for PGlite, skipping unsupported extensions (e.g. pg_search)
 */
const pgliteMigrateManual = async (pglite: PGlite): Promise<void> => {
  const migrationFiles = readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const filename of migrationFiles) {
    const filePath = join(migrationsFolder, filename);
    const sql = readFileSync(filePath, 'utf8');

    if (!sql.trim()) continue;

    // PGlite doesn't support pg_search extension, skip related migrations
    if (sql.includes('pg_search') || sql.includes('bm25')) continue;

    await pglite.exec(sql);
  }
};

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

  await pgliteMigrateManual(pglite);

  return testClientDB as unknown as LobeChatDatabase;
};
