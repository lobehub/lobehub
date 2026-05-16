import { join } from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { migrate as neonMigrate } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Client as PgClient } from 'pg';

// @ts-ignore tsgo handle esm import cjs and compatibility issues
import { DB_FAIL_INIT_HINT, DUPLICATE_EMAIL_HINT, PGVECTOR_HINT } from './errorHint';

// Load environment variables in priority order:
// 1. .env (lowest priority)
// 2. .env.local
// 3. .env.[env]
// 4. .env.[env].local (highest priority, overrides previous)
// Use dotenv-expand to support ${var} variable expansion
const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config()); // Load .env
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.local` })); // Load .env.local and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` })); // Load .env.[env] and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` })); // Load .env.[env].local and override

const migrationsFolder = join(__dirname, '../../packages/database/migrations');

const isVercelBuild = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
const shouldMigrateOnVercelBuild = process.env.MIGRATE_ON_VERCEL_BUILD === '1';
const shouldAutoRepairMigrationHistory = process.env.MIGRATION_AUTO_REPAIR === '1' || isVercelBuild;

const isOutOfSyncMigrationHistoryError = (err: unknown): boolean => {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  const query = ((err as { query?: string })?.query || '').toLowerCase();
  const message = ((err as { message?: string })?.message || '').toLowerCase();

  const missingRelation =
    code === '42P01' ||
    causeCode === '42P01' ||
    query.includes('relation') ||
    message.includes('relation');

  if (!missingRelation) return false;

  // Typical symptom when __drizzle_migrations points to a much later migration
  // while foundational tables were never created in this DB.
  return (
    query.includes('alter table "topics"') ||
    query.includes('insert into "verifications"') ||
    message.includes('relation "topics" does not exist') ||
    message.includes('relation "verifications" does not exist')
  );
};

const resetDrizzleMigrationHistory = async (dbUrl: string) => {
  const client = new PgClient({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle";');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        "id" SERIAL PRIMARY KEY,
        "hash" text NOT NULL,
        "created_at" bigint
      );
    `);
    await client.query('TRUNCATE TABLE "drizzle"."__drizzle_migrations";');
  } finally {
    await client.end();
  }
};

const runMigrations = async () => {
  const { serverDB } = await import('../../packages/database/src/server');

  const time = Date.now();
  if (process.env.DATABASE_DRIVER === 'node') {
    await nodeMigrate(serverDB, { migrationsFolder });
  } else {
    await neonMigrate(serverDB, { migrationsFolder });
  }

  console.log('✅ database migration pass. use: %s ms', Date.now() - time);

  process.exit(0);
};

const connectionString = process.env.DATABASE_URL;

// only migrate database if the connection string is available
if (isVercelBuild && !shouldMigrateOnVercelBuild) {
  console.log(
    '🟢 Vercel build detected. Skip db:migrate by default. Set MIGRATE_ON_VERCEL_BUILD=1 to enable.',
  );
} else if (connectionString) {
  runMigrations().catch(async (err) => {
    if (shouldAutoRepairMigrationHistory && isOutOfSyncMigrationHistoryError(err)) {
      console.info(
        '⚠️ Detected out-of-sync drizzle migration history. Resetting drizzle.__drizzle_migrations and retrying once...',
      );
      try {
        await resetDrizzleMigrationHistory(connectionString);
        await runMigrations();
        return;
      } catch (repairErr) {
        console.error('❌ Automatic migration history repair failed:', repairErr);
      }
    }

    console.error('❌ Database migrate failed:', err);

    const errMsg = err.message as string;

    const constraint = (err as { constraint?: string })?.constraint;

    if (errMsg.includes('extension "vector" is not available')) {
      console.info(PGVECTOR_HINT);
    } else if (constraint === 'users_email_unique' || errMsg.includes('users_email_unique')) {
      console.info(DUPLICATE_EMAIL_HINT);
    } else if ((err as { code?: string })?.code === '42P01') {
      console.info(
        'Hint: relation missing during migration (code 42P01). This usually means DB schema and migration history are out of sync.',
      );
      console.info(
        'For Vercel deploys, keep MIGRATE_ON_VERCEL_BUILD unset to skip migrations at build time, then run migrations manually in a controlled step.',
      );
    } else if (errMsg.includes(`Cannot read properties of undefined (reading 'migrate')`)) {
      console.info(DB_FAIL_INIT_HINT);
    }

    process.exit(1);
  });
} else {
  console.log('🟢 not find database env or in desktop mode, migration skipped');
}
