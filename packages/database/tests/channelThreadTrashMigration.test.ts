// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');

const seedThread = async (client: PGlite) => {
  const channelId = `channel-${randomUUID()}`;
  const rootMessageId = randomUUID();
  const threadId = `thread-${randomUUID()}`;
  await client.query('INSERT INTO channels (id, title, sequence) VALUES ($1, $2, 1)', [
    channelId,
    'Migration regression',
  ]);
  await client.query(
    `INSERT INTO channel_messages (id, channel_id, sequence, content, request_key, routing_status)
     VALUES ($1, $2, 1, 'Original message', $3, 'skipped')`,
    [rootMessageId, channelId, randomUUID()],
  );
  await client.query(
    `INSERT INTO channel_threads (id, channel_id, root_message_id, root_sequence, follower_member_ids)
     VALUES ($1, $2, $3, 1, '["original-member"]')`,
    [threadId, channelId, rootMessageId],
  );
  return { channelId, rootMessageId, threadId };
};

const assertTrashAndRecreate = async (client: PGlite) => {
  const { channelId, rootMessageId, threadId } = await seedThread(client);
  const insertThread = () =>
    client.query(
      `INSERT INTO channel_threads (id, channel_id, root_message_id, root_sequence)
       VALUES ($1, $2, $3, 1)`,
      [`thread-${randomUUID()}`, channelId, rootMessageId],
    );

  await expect(insertThread()).rejects.toMatchObject({ code: '23505' });
  await client.query(
    'UPDATE channel_threads SET is_deleted = true, deleted_at = now() WHERE id = $1',
    [threadId],
  );
  await insertThread();
  await expect(insertThread()).rejects.toMatchObject({ code: '23505' });
  await client.query(
    'UPDATE channel_threads SET is_deleted = true, deleted_at = now() WHERE channel_id = $1',
    [channelId],
  );
  await insertThread();
  const { rows } = await client.query<{ count: number; trashed: boolean }>(
    `SELECT is_deleted IS TRUE AS trashed, count(*)::int AS count FROM channel_threads
     WHERE channel_id = $1 GROUP BY 1 ORDER BY 1`,
    [channelId],
  );
  expect(rows).toEqual([
    { count: 1, trashed: false },
    { count: 2, trashed: true },
  ]);
};
// Every shipped Channel schema (foundation, writer guard, latest canary) must upgrade in place.
// Both the shipped foundation and the later writer-guard deployment must upgrade in place.
describe.each([184, 187, 188])(
  'Channel thread recycle-bin upgrade after migration %i',
  (lastMigration) => {
    const client = new PGlite({ extensions: { vector } });
    const db = drizzle({ client });
    let historicalFolder: string;
    let original: Awaited<ReturnType<typeof seedThread>>;

    beforeAll(async () => {
      historicalFolder = await mkdtemp(path.join(tmpdir(), 'lobe-channel-thread-trash-migration-'));
      await mkdir(path.join(historicalFolder, 'meta'));
      const entries = journal.entries.filter((entry) => entry.idx <= lastMigration);
      await Promise.all([
        writeFile(
          path.join(historicalFolder, 'meta/_journal.json'),
          JSON.stringify({ ...journal, entries }),
        ),
        ...entries.map(({ tag }) =>
          copyFile(
            path.join(migrationsFolder, `${tag}.sql`),
            path.join(historicalFolder, `${tag}.sql`),
          ),
        ),
      ]);
      await migrate(db, { migrationsFolder: historicalFolder });
      // Historical migrations are immutable: the fixture must still represent the old schema.
      const columns = await client.query(
        `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channel_threads' AND column_name = 'is_deleted'`,
      );
      expect(columns.rows).toHaveLength(0);
      original = await seedThread(client);
      await migrate(db, { migrationsFolder });
    }, 30_000);

    afterAll(async () => {
      await client.close();
      if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
    });

    it('preserves existing threads as live', async () => {
      const { rows } = await client.query(
        `SELECT is_deleted, deleted_at, follower_member_ids, root_sequence
       FROM channel_threads WHERE id = $1`,
        [original.threadId],
      );
      expect(rows).toEqual([
        {
          deleted_at: null,
          follower_member_ids: ['original-member'],
          is_deleted: null,
          root_sequence: 1,
        },
      ]);
    });

    it('replaces the old unique index and safely replays without losing trashed threads', async () => {
      await assertTrashAndRecreate(client);
      const before = await client.query('SELECT * FROM channel_threads ORDER BY id');
      const entry = journal.entries.find(({ tag }) => tag === '0189_channel_soft_delete');
      const migration = readMigrationFiles({ migrationsFolder }).find(
        ({ folderMillis }) => folderMillis === entry?.when,
      );
      if (!migration) throw new Error('Channel soft-delete migration not found');
      for (let replay = 0; replay < 2; replay += 1) {
        await db.transaction(async (tx) => {
          for (const statement of migration.sql) {
            await tx.execute(statement);
          }
        });
      }
      await migrate(db, { migrationsFolder });
      expect((await client.query('SELECT * FROM channel_threads ORDER BY id')).rows).toEqual(
        before.rows,
      );
      await assertTrashAndRecreate(client);
    });
  },
);

describe('Channel thread recycle bin on a fresh database', () => {
  const client = new PGlite({ extensions: { vector } });

  afterAll(async () => {
    await client.close();
  });

  it('replays the complete migration history with active-root uniqueness', async () => {
    await migrate(drizzle({ client }), { migrationsFolder });
    await assertTrashAndRecreate(client);
  }, 30_000);
});
