// @vitest-environment node
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
import { createChannelFixture, jobsOf } from '../src/repositories/channel/__tests__/testUtils';
import * as schema from '../src/schemas';
import type { LobeChatDatabase } from '../src/type';

const migrationsFolder = path.join(__dirname, '../migrations');
const TAG = '0194_channel_jobs_drop_delivery_key';

describe('Channel delivery key removal', () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client, schema });
  const database = db as unknown as LobeChatDatabase;
  const fixture = createChannelFixture(database, 'channel-delivery-key-migration');
  let historicalFolder: string;
  let messageId: string;
  let originalJobs: Awaited<ReturnType<typeof jobsOf>>;

  beforeAll(async () => {
    historicalFolder = await mkdtemp(path.join(tmpdir(), 'lobe-channel-delivery-key-migration-'));
    await mkdir(path.join(historicalFolder, 'meta'));
    const last = journal.entries.findIndex(({ tag }) => tag === TAG);
    if (last < 0) throw new Error('Channel delivery key migration not found');
    const entries = journal.entries.slice(0, last);
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
    await fixture.setup();
    const { asOwner, channel } = await fixture.createTeamChannel();
    await fixture.addAgent(channel.id, 'Coder');
    await fixture.addAgent(channel.id, 'Reviewer');
    const message = await asOwner.send(channel.id, {
      content: 'Keep both deliveries',
      requestKey: 'once',
      routing: 'fallback',
    });
    messageId = message.id;
    originalJobs = await jobsOf(database, messageId);
    expect(originalJobs).toHaveLength(2);
    const oldKeys = await client.query('SELECT delivery_key FROM channel_jobs');
    expect(oldKeys.rows).toEqual([{ delivery_key: 'initial' }, { delivery_key: 'initial' }]);

    await migrate(db, { migrationsFolder });
  }, 30_000);

  afterAll(async () => {
    await client.close();
    if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
  });

  it('preserves existing jobs and removes the unused column', async () => {
    expect(await jobsOf(database, messageId)).toEqual(expect.arrayContaining(originalJobs));
    expect(await jobsOf(database, messageId)).toHaveLength(2);
    const columns = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channel_jobs' AND column_name = 'delivery_key'`,
    );
    expect(columns.rows).toHaveLength(0);
  });

  it('replays safely and enforces uniqueness by message and member', async () => {
    const entry = journal.entries.find(({ tag }) => tag === TAG);
    const migration = readMigrationFiles({ migrationsFolder }).find(
      ({ folderMillis }) => folderMillis === entry?.when,
    );
    if (!migration) throw new Error('Channel delivery key migration not found');
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) await tx.execute(statement);
    });

    const duplicate = await db
      .insert(schema.channelJobs)
      .values({ ...originalJobs[0], id: undefined })
      .onConflictDoNothing({ target: [schema.channelJobs.messageId, schema.channelJobs.memberId] })
      .returning();
    expect(duplicate).toEqual([]);
    expect(await jobsOf(database, messageId)).toEqual(expect.arrayContaining(originalJobs));
    expect(await jobsOf(database, messageId)).toHaveLength(2);
  });
});
