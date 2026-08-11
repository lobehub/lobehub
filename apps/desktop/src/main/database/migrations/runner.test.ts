import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { localDatabaseMigrations } from './index';
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

  it('preserves existing Projection entity fragments when expanding the typed tables', () => {
    database = new DatabaseSync(':memory:');
    const previousMigrations = localDatabaseMigrations.slice(0, -1);
    expect(previousMigrations.length).toBeGreaterThan(0);

    runLocalDatabaseMigrations(database, previousMigrations);

    const seeds = [
      ['projection_agents', 'agent-1', 'identity'],
      ['projection_briefs', 'brief-1', 'content'],
      ['projection_chat_groups', 'group-1', 'identity'],
      ['projection_tasks', 'task-1', 'display'],
      ['projection_topics', 'topic-1', 'display'],
    ] as const;

    for (const [table, entityId, fragment] of seeds) {
      database
        .prepare(
          `INSERT INTO ${table} (storage_id, entity_id, scope, ${fragment}_data, ${fragment}_observed_at, ${fragment}_source) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `user-1:personal:${entityId}`,
          entityId,
          'user-1:personal',
          JSON.stringify({ title: `${entityId} before upgrade` }),
          100,
          'network',
        );
    }

    runLocalDatabaseMigrations(database, localDatabaseMigrations);

    expect(
      database
        .prepare('SELECT entity_id, identity_data, configuration_data FROM projection_agents')
        .get(),
    ).toEqual({
      configuration_data: null,
      entity_id: 'agent-1',
      identity_data: JSON.stringify({ title: 'agent-1 before upgrade' }),
    });
    expect(database.prepare('SELECT entity_id, content_data FROM projection_briefs').get()).toEqual(
      {
        content_data: JSON.stringify({ title: 'brief-1 before upgrade' }),
        entity_id: 'brief-1',
      },
    );
    expect(
      database
        .prepare('SELECT entity_id, identity_data, configuration_data FROM projection_chat_groups')
        .get(),
    ).toEqual({
      configuration_data: null,
      entity_id: 'group-1',
      identity_data: JSON.stringify({ title: 'group-1 before upgrade' }),
    });
    expect(
      database.prepare('SELECT entity_id, display_data, detail_data FROM projection_tasks').get(),
    ).toEqual({
      detail_data: null,
      display_data: JSON.stringify({ title: 'task-1 before upgrade' }),
      entity_id: 'task-1',
    });
    expect(
      database
        .prepare('SELECT entity_id, display_data, analytics_data FROM projection_topics')
        .get(),
    ).toEqual({
      analytics_data: null,
      display_data: JSON.stringify({ title: 'topic-1 before upgrade' }),
      entity_id: 'topic-1',
    });
  });
});
