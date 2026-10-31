import { readMigrationFiles } from 'drizzle-orm/migrator';

/** Unpublished local branch at 4d02573611; never part of the release journal. */
export const legacyLobeBenchMigrations = [
  {
    created_at: 1792600439243,
    hash: '2597ac8747426a5e7f0edc2764c42a721a0c45a43649eec3381ccb3f6c3b5ad8',
  },
  {
    created_at: 1793058978085,
    hash: '6112a802bd273f3e68ce428bb92b4e5dcadd788667186633512ea53fb5aad82c',
  },
  {
    created_at: 1793064460496,
    hash: 'a0c10baddb98c2f27daacb47faed4f7241ef32e23a0ea144ac74a0e4695606a1',
  },
  {
    created_at: 1793064463665,
    hash: '5b34ed0c4b23aeef245628125b10c716e5131aaaa4051e397ea3bf0aff97b003',
  },
  {
    created_at: 1793239418975,
    hash: 'd526942e3eec655ddd1e679cc5c620ec5ba79aa5dd3d67ade88c84d9a91bfb0b',
  },
] as const;

interface MigrationRow {
  created_at: number | string;
  hash: string;
}

export interface MigrationClient {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
}

const historyMatches = (actual: MigrationRow[], expected: MigrationRow[]) =>
  actual.length === expected.length &&
  actual.every(
    (row, i) =>
      row.hash === expected[i].hash && Number(row.created_at) === Number(expected[i].created_at),
  );

/** Recognize complete known histories only; a matching latest timestamp is insufficient. */
export function planLobeBenchUpgrade(history: MigrationRow[], migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const canonical = migrations.map(({ folderMillis, hash }) => ({
    created_at: folderMillis,
    hash,
  }));
  if (historyMatches(history, canonical)) return { kind: 'current' as const, pending: [] };

  const expectedLegacy = [...canonical.slice(0, 182), ...legacyLobeBenchMigrations];
  if (!historyMatches(history, expectedLegacy)) {
    throw new Error(
      'Unknown migration history: no changes made. Restore/review the database separately.',
    );
  }
  return { kind: 'legacy' as const, pending: migrations.slice(182) };
}

/**
 * This is a local repair, separate from deployment migrations. The application
 * must be stopped and a tested backup taken before apply=true. Both journal
 * repair and canonical migration replay commit together, or neither does.
 */
export async function upgradeLobeBenchDatabase(
  client: MigrationClient,
  options: { apply: boolean; migrationsFolder: string },
) {
  await client.query(options.apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    if (options.apply) {
      await client.query('LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE');
    }
    const { rows } = await client.query(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
    );
    const plan = planLobeBenchUpgrade(rows, options.migrationsFolder);
    if (plan.kind === 'legacy') {
      // Only the final branch schema is supported. Never drop a live old scope,
      // delete synthetic owners, or reinterpret a partially migrated database.
      const schema = await client.query(`SELECT
        to_regclass('public.agent_eval_memory_scopes') AS legacy_scopes,
        to_regclass('public.agent_eval_memories') AS memories,
        to_regclass('public.agent_eval_environments') AS environments`);
      if (
        schema.rows[0].legacy_scopes ||
        !schema.rows[0].memories ||
        !schema.rows[0].environments
      ) {
        throw new Error('Unexpected legacy schema: no changes made.');
      }
    }
    if (!options.apply || plan.kind === 'current') {
      await client.query('ROLLBACK');
      return { applied: false, kind: plan.kind, migrations: plan.pending.length };
    }

    for (const legacy of legacyLobeBenchMigrations) {
      await client.query(
        'DELETE FROM drizzle.__drizzle_migrations WHERE hash = $1 AND created_at = $2',
        [legacy.hash, legacy.created_at],
      );
    }
    for (const migration of plan.pending) {
      for (const statement of migration.sql) await client.query(statement);
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.folderMillis],
      );
    }
    await client.query('COMMIT');
    return { applied: true, kind: plan.kind, migrations: plan.pending.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
