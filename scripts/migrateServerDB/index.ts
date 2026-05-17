import path from 'node:path';

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

const migrationsFolder = path.join(__dirname, '../../packages/database/migrations');

const isVercelBuild = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
const shouldSkipMigrateOnVercelBuild = process.env.MIGRATE_ON_VERCEL_BUILD === '0';
const shouldAutoRepairMigrationHistory = process.env.MIGRATION_AUTO_REPAIR === '1' || isVercelBuild;
const shouldRepairLegacyAuthOnly = process.env.MIGRATION_REPAIR_LEGACY_AUTH_ONLY === '1';

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

const runLegacyAuthSchemaRepair = async (dbUrl: string) => {
  const client = new PgClient({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'email_verified'
            AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
        ) THEN
          ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_tmp" boolean;
          UPDATE "users" SET "email_verified_tmp" = ("email_verified" IS NOT NULL) WHERE "email_verified_tmp" IS NULL;
          ALTER TABLE "users" DROP COLUMN "email_verified";
          ALTER TABLE "users" RENAME COLUMN "email_verified_tmp" TO "email_verified";
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "username" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "normalized_email" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "avatar" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "first_name" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "last_name" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "full_name" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "interests" varchar(64)[];
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "is_onboarded" boolean DEFAULT false;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "agent_onboarding" jsonb;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "onboarding" jsonb;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "clerk_created_at" timestamp with time zone;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "preference" jsonb;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "role" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "ban_reason" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp with time zone;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "phone" text;
      ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean;

      UPDATE "users" SET "email_verified" = false WHERE "email_verified" IS NULL;
      UPDATE "users" SET "created_at" = now() WHERE "created_at" IS NULL;
      UPDATE "users" SET "updated_at" = now() WHERE "updated_at" IS NULL;
      UPDATE "users" SET "accessed_at" = now() WHERE "accessed_at" IS NULL;
      UPDATE "users" SET "last_active_at" = now() WHERE "last_active_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
      CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
      CREATE UNIQUE INDEX IF NOT EXISTS "users_normalized_email_unique" ON "users" ("normalized_email");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "accounts" (
        "access_token" text,
        "access_token_expires_at" timestamp with time zone,
        "account_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "id" text PRIMARY KEY,
        "id_token" text,
        "password" text,
        "provider_id" text,
        "refresh_token" text,
        "refresh_token_expires_at" timestamp with time zone,
        "scope" text,
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        "user_id" text
      );

      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "id" text;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "account_id" text;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "provider_id" text;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp with time zone;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" timestamp with time zone;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
      ALTER TABLE IF EXISTS "accounts" ADD COLUMN IF NOT EXISTS "password" text;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider'
        ) THEN
          UPDATE "accounts"
          SET "provider_id" = COALESCE("provider_id", "provider")
          WHERE "provider_id" IS NULL;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider_account_id'
        ) THEN
          UPDATE "accounts"
          SET "account_id" = COALESCE("account_id", "provider_account_id")
          WHERE "account_id" IS NULL;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'expires_at'
        ) THEN
          UPDATE "accounts"
          SET "access_token_expires_at" = to_timestamp("expires_at")
          WHERE "access_token_expires_at" IS NULL AND "expires_at" IS NOT NULL;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
           AND tc.table_name = kcu.table_name
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'accounts'
            AND tc.constraint_type = 'PRIMARY KEY'
            AND kcu.column_name IN ('provider', 'provider_account_id')
        ) THEN
          EXECUTE (
            SELECT format('ALTER TABLE "accounts" DROP CONSTRAINT %I', tc.constraint_name)
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            WHERE tc.table_schema = 'public'
              AND tc.table_name = 'accounts'
              AND tc.constraint_type = 'PRIMARY KEY'
              AND kcu.column_name IN ('provider', 'provider_account_id')
            LIMIT 1
          );
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'type'
        ) THEN
          ALTER TABLE "accounts" ALTER COLUMN "type" DROP NOT NULL;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider'
        ) THEN
          ALTER TABLE "accounts" ALTER COLUMN "provider" DROP NOT NULL;
        END IF;
      END $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider_account_id'
        ) THEN
          ALTER TABLE "accounts" ALTER COLUMN "provider_account_id" DROP NOT NULL;
        END IF;
      END $$;

      UPDATE "accounts" SET "created_at" = now() WHERE "created_at" IS NULL;
      UPDATE "accounts" SET "updated_at" = now() WHERE "updated_at" IS NULL;
      UPDATE "accounts"
      SET "id" = COALESCE("id", CONCAT('legacy_', SUBSTRING(md5(random()::text || clock_timestamp()::text), 1, 24)))
      WHERE "id" IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "accounts_id_unique" ON "accounts" ("id");
      CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "accounts" ("user_id");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "verifications" (
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "id" text PRIMARY KEY NOT NULL,
        "identifier" text NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "value" text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verifications" ("identifier");
    `);

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'sessions'
        ) THEN
          ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "id" text;

          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'sessions'
              AND column_name = 'session_token'
          ) THEN
            UPDATE "sessions"
            SET "id" = COALESCE("id", "session_token")
            WHERE "id" IS NULL;
          END IF;

          UPDATE "sessions"
          SET "id" = COALESCE("id", CONCAT('legacy_', SUBSTRING(md5(random()::text || clock_timestamp()::text), 1, 24)))
          WHERE "id" IS NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS "sessions_id_unique" ON "sessions" ("id");
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "auth_sessions" (
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "id" text PRIMARY KEY NOT NULL,
        "impersonated_by" text,
        "ip_address" text,
        "token" text NOT NULL,
        "updated_at" timestamp with time zone NOT NULL,
        "user_agent" text,
        "user_id" text NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_unique" ON "auth_sessions" ("token");
      CREATE INDEX IF NOT EXISTS "auth_session_userId_idx" ON "auth_sessions" ("user_id");
    `);
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
if (isVercelBuild && shouldSkipMigrateOnVercelBuild) {
  console.log('🟢 Vercel build detected. Skip db:migrate because MIGRATE_ON_VERCEL_BUILD=0.');
} else if (connectionString) {
  (async () => {
    if (shouldRepairLegacyAuthOnly) {
      console.info(
        '🛠️ Running legacy auth schema repair only (MIGRATION_REPAIR_LEGACY_AUTH_ONLY=1)...',
      );
      const time = Date.now();
      await runLegacyAuthSchemaRepair(connectionString);
      console.info('✅ Legacy auth schema repair pass. use: %s ms', Date.now() - time);
      process.exit(0);
    }

    await runMigrations();
  })().catch(async (err) => {
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
        'For Vercel deploys, migrations run by default when DATABASE_URL is set. Set MIGRATE_ON_VERCEL_BUILD=0 only if you intentionally want to skip.',
      );
    } else if (errMsg.includes(`Cannot read properties of undefined (reading 'migrate')`)) {
      console.info(DB_FAIL_INIT_HINT);
    }

    process.exit(1);
  });
} else {
  console.log('🟢 not find database env or in desktop mode, migration skipped');
}
