import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { localDatabaseMigrations } from './index';
import type { LocalDatabaseMigration } from './types';

interface AppliedMigration {
  checksum: string;
  name: string;
  version: number;
}

const MIGRATIONS_TABLE = '__local_database_migrations';

const migrationChecksum = (migration: LocalDatabaseMigration) =>
  createHash('sha256')
    .update(JSON.stringify([migration.version, migration.name, migration.statements]))
    .digest('hex');

const validateManifest = (migrations: readonly LocalDatabaseMigration[]) => {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;

    if (migration.version !== expectedVersion) {
      throw new Error(
        `Local database migration sequence is invalid: expected version ${expectedVersion}, received ${migration.version}`,
      );
    }

    if (migration.statements.length === 0) {
      throw new Error(`Local database migration ${migration.version} has no statements`);
    }
  }
};

const initializeMigrationTable = (database: DatabaseSync) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
};

const readAppliedMigrations = (database: DatabaseSync): AppliedMigration[] =>
  database
    .prepare(`SELECT version, name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`)
    .all() as unknown as AppliedMigration[];

const validateAppliedMigrations = (
  appliedMigrations: AppliedMigration[],
  migrations: readonly LocalDatabaseMigration[],
) => {
  for (const [index, applied] of appliedMigrations.entries()) {
    const expectedVersion = index + 1;

    if (applied.version !== expectedVersion) {
      throw new Error(
        `Local database migration history is not contiguous: expected version ${expectedVersion}, received ${applied.version}`,
      );
    }

    const migration = migrations[applied.version - 1];

    if (!migration) {
      throw new Error(
        `Local database version ${applied.version} is newer than this application supports`,
      );
    }

    if (applied.name !== migration.name || applied.checksum !== migrationChecksum(migration)) {
      throw new Error(
        `Local database migration ${applied.version} (${applied.name}) differs from the application manifest`,
      );
    }
  }
};

const applyMigration = (database: DatabaseSync, migration: LocalDatabaseMigration) => {
  database.exec('BEGIN IMMEDIATE');

  try {
    for (const statement of migration.statements) database.exec(statement);

    database
      .prepare(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
      )
      .run(migration.version, migration.name, migrationChecksum(migration), Date.now());
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
};

export const runLocalDatabaseMigrations = (
  database: DatabaseSync,
  migrations: readonly LocalDatabaseMigration[] = localDatabaseMigrations,
): void => {
  validateManifest(migrations);
  initializeMigrationTable(database);

  const appliedMigrations = readAppliedMigrations(database);
  validateAppliedMigrations(appliedMigrations, migrations);
  const appliedVersions = new Set(appliedMigrations.map(({ version }) => version));

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) applyMigration(database, migration);
  }
};
