import { join } from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate as neonMigrate } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';

import { isPgSearchUnavailableError, migrationUsesPgSearchOrBm25 } from './bm25Compatibility';
// @ts-ignore tsgo handle esm import cjs and compatibility issues
import { DB_FAIL_INIT_HINT, DUPLICATE_EMAIL_HINT, PGVECTOR_HINT } from './errorHint';

// Load environment variables in priority order:
// 1. .env (lowest priority)
// 2. .env.[env] (medium priority, overrides .env)
// 3. .env.[env].local (highest priority, overrides previous)
// Use dotenv-expand to support ${var} variable expansion
const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config()); // Load .env
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` })); // Load .env.[env] and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` })); // Load .env.[env].local and override

const migrationsFolder = join(__dirname, '../../packages/database/migrations');

const migrateSkippingUnavailableBm25 = async (serverDB: {
  execute: (query: unknown) => Promise<unknown>;
}) => {
  const migrations = readMigrationFiles({ migrationsFolder });

  await serverDB.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await serverDB.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const applied = (await serverDB.execute(sql`
    SELECT hash FROM "drizzle"."__drizzle_migrations"
  `)) as { rows?: Array<{ hash: string }> } | Array<{ hash: string }>;

  const appliedRows = Array.isArray(applied) ? applied : (applied.rows ?? []);
  const appliedHashes = new Set(appliedRows.map((row) => row.hash));

  let skipped = 0;

  for (const migration of migrations) {
    if (appliedHashes.has(migration.hash)) continue;

    const skipSql = migrationUsesPgSearchOrBm25(migration.sql);

    if (skipSql) {
      skipped += 1;
      console.warn(
        `⚠️ Skipping BM25/pg_search migration "${migration.hash}" (extension unavailable)`,
      );
    } else {
      for (const stmt of migration.sql) {
        await serverDB.execute(sql.raw(stmt));
      }
    }

    await serverDB.execute(
      sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
    );
  }

  if (skipped > 0) {
    console.warn(
      `⚠️ Skipped ${skipped} ParadeDB BM25 migration(s). Full-text BM25 search will be unavailable until pg_search is supported.`,
    );
  }
};

const runMigrations = async () => {
  const { serverDB } = await import('../../packages/database/src/server');

  const time = Date.now();
  const useNodeDriver = process.env.DATABASE_DRIVER === 'node';

  try {
    if (useNodeDriver) {
      await nodeMigrate(serverDB, { migrationsFolder });
    } else {
      await neonMigrate(serverDB, { migrationsFolder });
    }
  } catch (error) {
    if (!isPgSearchUnavailableError(error)) throw error;

    console.warn(
      '⚠️ pg_search is not available on this database (common on Neon). Replaying migrations while skipping BM25/pg_search statements…',
    );
    await migrateSkippingUnavailableBm25(serverDB);
  }

  console.log('✅ database migration pass. use: %s ms', Date.now() - time);

  process.exit(0);
};

const connectionString = process.env.DATABASE_URL;

// only migrate database if the connection string is available
if (connectionString) {
  runMigrations().catch((err) => {
    console.error('❌ Database migrate failed:', err);

    const errMsg = err.message as string;

    const constraint = (err as { constraint?: string })?.constraint;

    if (errMsg.includes('extension "vector" is not available')) {
      console.info(PGVECTOR_HINT);
    } else if (constraint === 'users_email_unique' || errMsg.includes('users_email_unique')) {
      console.info(DUPLICATE_EMAIL_HINT);
    } else if (errMsg.includes(`Cannot read properties of undefined (reading 'migrate')`)) {
      console.info(DB_FAIL_INIT_HINT);
    }

    process.exit(1);
  });
} else {
  console.log('🟢 not find database env or in desktop mode, migration skipped');
}
