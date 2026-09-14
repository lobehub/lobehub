import fs from 'node:fs';
import path from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate as neonMigrate } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';

import {
  assertPr18624SchemaShape,
  checkPr18624LegacyHistory,
  type Pr18624BridgeDatabase,
  type Pr18624MigrationFile,
  runPr18624LegacyBridge,
} from '../../packages/database/migration-tools/pr18624LegacyBridge';
// @ts-ignore tsgo handle esm import cjs and compatibility issues
import { DB_FAIL_INIT_HINT, DUPLICATE_EMAIL_HINT, PGVECTOR_HINT } from './errorHint';
import { runWithLockRetry } from './retry';

// Load environment variables in priority order:
// 1. .env (lowest priority)
// 2. .env.[env] (medium priority, overrides .env)
// 3. .env.[env].local (highest priority, overrides previous)
// Use dotenv-expand to support ${var} variable expansion
const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config()); // Load .env
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` })); // Load .env.[env] and override
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` })); // Load .env.[env].local and override

const migrationsFolder = path.join(__dirname, '../../packages/database/migrations');

interface MigrationJournal {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
}

export interface MigrationWorkflowOptions {
  database: unknown;
  migrate: (database: unknown, config: { migrationsFolder: string }) => Promise<void>;
  migrationsFolder: string;
}

export const isMissingMigrationTableError = (error: unknown): boolean => {
  const visited = new Set<object>();
  let current: unknown = error;

  // DrizzleQueryError stores the PostgreSQL error in `cause`; keep this walk
  // bounded so an arbitrary error graph can never become a migration bypass.
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object' || visited.has(current)) return false;
    visited.add(current);

    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const message = String(candidate.message || '').toLowerCase();
    const namesMigrationTable = message.includes('__drizzle_migrations');
    const isMissingRelation =
      message.includes('does not exist') || message.includes('undefined_table');
    const isMissingMigrationSchema =
      candidate.code === '3F000' &&
      message.includes('schema') &&
      message.includes('drizzle') &&
      message.includes('does not exist');
    if (
      (candidate.code === '42P01' && namesMigrationTable && isMissingRelation) ||
      isMissingMigrationSchema
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
};

const loadMigrationFiles = (folder: string): Pr18624MigrationFile[] => {
  const journalPath = path.join(folder, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
  const files = readMigrationFiles({ migrationsFolder: folder });
  if (files.length !== journal.entries.length) {
    throw new Error(
      `Migration journal/file count mismatch: journal=${journal.entries.length}, files=${files.length}`,
    );
  }
  return journal.entries.map((entry, index) => ({
    ...files[index],
    tag: entry.tag,
  }));
};

const preflightPr18624History = async (
  database: Pr18624BridgeDatabase,
  laterMigrations: readonly { sha256: string; when: number }[],
) => {
  try {
    return await checkPr18624LegacyHistory(database, laterMigrations);
  } catch (error) {
    if (isMissingMigrationTableError(error)) return 'clean' as const;
    throw new Error(
      `PR18624 migration history preflight failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

/**
 * Run the complete migration workflow. Keeping this seam injectable lets the
 * real-driver test exercise the same bridge/runner ordering without importing
 * this script's environment bootstrap.
 */
export const runMigrationWorkflow = async ({
  database,
  migrate,
  migrationsFolder: folder,
}: MigrationWorkflowOptions): Promise<void> => {
  const migrations = loadMigrationFiles(folder);
  const laterMigrations = migrations
    .filter((migration) => Number(migration.tag.slice(0, 4)) >= 162)
    .map((migration) => ({ sha256: migration.hash, when: migration.folderMillis }));
  const bridgeDatabase = database as Pr18624BridgeDatabase;
  const history = await preflightPr18624History(bridgeDatabase, laterMigrations);

  if (history === 'legacy') {
    await runPr18624LegacyBridge(bridgeDatabase, migrations, laterMigrations);
  }

  await migrate(database, { migrationsFolder: folder });
  await assertPr18624SchemaShape(bridgeDatabase);
};

const runMigrations = async () => {
  const { serverDB } = await import('../../packages/database/src/server');

  const time = Date.now();
  await runWithLockRetry(async () => {
    const migrate =
      process.env.DATABASE_DRIVER === 'node'
        ? (nodeMigrate as unknown as MigrationWorkflowOptions['migrate'])
        : (neonMigrate as unknown as MigrationWorkflowOptions['migrate']);
    await runMigrationWorkflow({ database: serverDB, migrate, migrationsFolder });
  });

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
