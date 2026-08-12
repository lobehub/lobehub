import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { runLocalDatabaseMigrations } from './runner';
import type { LocalDatabaseMigration } from './types';

describe('runLocalDatabaseMigrations', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('applies pending migrations exactly once and records their versions', () => {
    database = new DatabaseSync(':memory:');
    const migrations = [
      {
        name: 'create_items',
        statements: ['CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL)'],
        version: 1,
      },
      {
        name: 'seed_item',
        statements: ["INSERT INTO items (id) VALUES ('seed')"],
        version: 2,
      },
    ] satisfies readonly LocalDatabaseMigration[];

    runLocalDatabaseMigrations(database, migrations);
    runLocalDatabaseMigrations(database, migrations);

    expect(database.prepare('SELECT id FROM items').all()).toEqual([{ id: 'seed' }]);
    expect(database.prepare('SELECT version FROM __local_database_migrations').all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });

  it('rolls back a failed migration without reverting earlier versions', () => {
    database = new DatabaseSync(':memory:');
    const migrations = [
      {
        name: 'create_stable_table',
        statements: ['CREATE TABLE stable_items (id TEXT PRIMARY KEY NOT NULL)'],
        version: 1,
      },
      {
        name: 'create_invalid_table',
        statements: [
          'CREATE TABLE rolled_back_items (id TEXT PRIMARY KEY NOT NULL)',
          'INSERT INTO missing_table (id) VALUES (1)',
        ],
        version: 2,
      },
    ] satisfies readonly LocalDatabaseMigration[];

    expect(() => runLocalDatabaseMigrations(database!, migrations)).toThrow();

    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stable_items'")
        .get(),
    ).toEqual({ name: 'stable_items' });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rolled_back_items'",
        )
        .get(),
    ).toBeUndefined();
    expect(database.prepare('SELECT version FROM __local_database_migrations').all()).toEqual([
      { version: 1 },
    ]);
  });

  it('rejects edits to an already applied migration', () => {
    database = new DatabaseSync(':memory:');
    const migration = {
      name: 'create_items',
      statements: ['CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL)'],
      version: 1,
    } satisfies LocalDatabaseMigration;
    runLocalDatabaseMigrations(database, [migration]);

    expect(() =>
      runLocalDatabaseMigrations(database!, [
        { ...migration, statements: ['CREATE TABLE changed_items (id TEXT PRIMARY KEY NOT NULL)'] },
      ]),
    ).toThrow('differs from the application manifest');
  });

  it('rejects gaps in applied migration history', () => {
    database = new DatabaseSync(':memory:');
    const migrations = [
      {
        name: 'create_items',
        statements: ['CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL)'],
        version: 1,
      },
      {
        name: 'add_item_value',
        statements: ['ALTER TABLE items ADD COLUMN value TEXT'],
        version: 2,
      },
    ] satisfies readonly LocalDatabaseMigration[];
    runLocalDatabaseMigrations(database, migrations);
    database.prepare('DELETE FROM __local_database_migrations WHERE version = 1').run();

    expect(() => runLocalDatabaseMigrations(database!, migrations)).toThrow(
      'migration history is not contiguous',
    );
  });
});
