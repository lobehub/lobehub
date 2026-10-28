// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  channelJobs,
  channelMemberGrants,
  channelMessages,
  channelThreads,
} from '../src/schemas/channel';

const indexes = [
  {
    columns: ['user_id'],
    name: 'channel_messages_user_id_idx',
    predicate: 'user_id IS NOT NULL',
    table: channelMessages,
  },
  {
    columns: ['agent_id'],
    name: 'channel_messages_agent_id_idx',
    predicate: 'agent_id IS NOT NULL',
    table: channelMessages,
  },
  {
    columns: ['channel_id', 'requested_by_member_id'],
    name: 'channel_member_grants_channel_requester_idx',
    predicate: null,
    table: channelMemberGrants,
  },
  {
    columns: ['channel_id', 'requester_member_id'],
    name: 'channel_jobs_channel_requester_idx',
    predicate: null,
    table: channelJobs,
  },
  {
    columns: ['channel_id', 'thread_id', 'created_at'],
    name: 'channel_jobs_channel_thread_created_at_idx',
    predicate: null,
    table: channelJobs,
  },
  {
    columns: ['channel_id', 'root_message_id'],
    name: 'channel_threads_root_message_idx',
    predicate: null,
    table: channelThreads,
  },
];

describe('Channel foreign-key lookup indexes', () => {
  const client = new PGlite({ extensions: { vector } });

  beforeAll(async () => {
    await migrate(drizzle({ client }), { migrationsFolder: path.join(__dirname, '../migrations') });
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  it('can replay the index migration when the indexes already exist', async () => {
    const migration = await readFile(
      path.join(__dirname, '../migrations/0192_channel_foreign_key_indexes.sql'),
      'utf8',
    );
    const before = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
      [indexes.map(({ name }) => name)],
    );
    await client.exec(migration);
    const after = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY indexname`,
      [indexes.map(({ name }) => name)],
    );
    expect(before.rows).toHaveLength(indexes.length);
    expect(after.rows).toEqual(before.rows);
  });

  it.each(indexes)('declares $name in the schema', ({ columns, name, predicate, table }) => {
    const config = getTableConfig(table);
    const index = config.indexes.find((entry) => entry.config.name === name)?.config;
    expect(index).toBeDefined();
    expect(index!.columns.map((column) => ('name' in column ? column.name : undefined))).toEqual(
      columns,
    );
    expect(index!.unique).toBe(false);
    if (predicate) {
      expect(new PgDialect().sqlToQuery(index!.where!).sql).toBe(
        `"${config.name}"."${columns[0]}" IS NOT NULL`,
      );
    } else {
      // In particular, root-message lookup must include trashed threads, unlike the
      // live-root unique index. Foreign-key checks cannot imply a soft-delete predicate.
      expect(index!.where).toBeUndefined();
    }
  });

  it.each(indexes)(
    'installs a valid $name on migration replay',
    async ({ columns, name, predicate }) => {
      const { rows } = await client.query<{
        columns: string[];
        indisunique: boolean;
        indisvalid: boolean;
        predicate: string | null;
      }>(
        `SELECT i.indisvalid, i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS predicate,
         ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
           ORDER BY k.position) AS columns
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1`,
        [name],
      );
      expect(rows).toEqual([
        {
          columns,
          indisunique: false,
          indisvalid: true,
          predicate: predicate ? `(${predicate})` : null,
        },
      ]);
    },
  );
});
