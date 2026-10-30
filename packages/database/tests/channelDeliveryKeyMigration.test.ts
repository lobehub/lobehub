// @vitest-environment node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { eq } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';
import { createChannelFixture, jobsOf } from '../src/repositories/channel/__tests__/testUtils';
import * as schema from '../src/schemas';
import type { LobeChatDatabase } from '../src/type';

const migrationsFolder = path.join(__dirname, '../migrations');
const TAG = '0195_channel_jobs_message_member_unique';

// Old binaries include delivery_key in implicit SELECT, INSERT and RETURNING lists.
const legacyJobs = pgTable('channel_jobs', {
  channelId: text('channel_id').notNull(),
  deliveryKey: text('delivery_key').notNull().default('initial'),
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id').notNull(),
  messageId: uuid('message_id').notNull(),
  requesterMemberId: uuid('requester_member_id').notNull(),
});

const createDatabase = () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client, schema });
  const database = db as unknown as LobeChatDatabase;
  const fixture = createChannelFixture(database, 'channel-delivery-key-migration');
  return { client, database, db, fixture };
};

describe('Channel delivery key retirement', () => {
  let context: ReturnType<typeof createDatabase>;
  let team: Awaited<ReturnType<typeof context.fixture.createTeamChannel>>;
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
  });

  beforeEach(async () => {
    context = createDatabase();
    const { database, db, fixture } = context;
    await migrate(db, { migrationsFolder: historicalFolder });
    await fixture.setup();
    team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Coder');
    await fixture.addAgent(team.channel.id, 'Reviewer');
    const message = await team.asOwner.send(team.channel.id, {
      content: 'Keep both deliveries',
      requestKey: 'once',
      routing: 'fallback',
    });
    messageId = message.id;
    originalJobs = await jobsOf(database, messageId);
    expect(originalJobs).toHaveLength(2);
  }, 30_000);

  afterEach(async () => {
    await context.client.close();
  });

  afterAll(async () => {
    if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
  });

  it('preserves existing jobs and the legacy column default during rollout', async () => {
    const { client, database, db } = context;
    await migrate(db, { migrationsFolder });

    expect(await jobsOf(database, messageId)).toEqual(expect.arrayContaining(originalJobs));
    expect(await jobsOf(database, messageId)).toHaveLength(2);
    const columns = await client.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'channel_jobs' AND column_name = 'delivery_key'`,
    );
    expect(columns.rows).toEqual([{ column_default: "'initial'::text", is_nullable: 'NO' }]);
    expect(await db.select().from(legacyJobs)).toEqual(
      originalJobs.map((job) => expect.objectContaining({ deliveryKey: 'initial', id: job.id })),
    );
  });

  it('supports legacy and new ORM reads and writes against the same migrated database', async () => {
    const { database, db } = context;
    await migrate(db, { migrationsFolder });

    const legacyMessage = await team.asOwner.send(team.channel.id, {
      content: 'Delivered by an old worker',
      mentions: [team.owner.id],
      requestKey: 'legacy-worker',
      routing: 'decision',
    });
    expect(await jobsOf(database, legacyMessage.id)).toEqual([]);
    const values = { ...originalJobs[0], id: undefined, messageId: legacyMessage.id };
    const [legacyJob] = await db.insert(legacyJobs).values(values).returning();
    expect(legacyJob.deliveryKey).toBe('initial');
    expect(await db.insert(legacyJobs).values(values).onConflictDoNothing().returning()).toEqual(
      [],
    );
    expect(await jobsOf(database, legacyMessage.id)).toEqual([
      expect.objectContaining({ id: legacyJob.id, messageId: legacyMessage.id }),
    ]);

    const newMessage = await team.asOwner.send(team.channel.id, {
      content: 'Delivered by a new worker',
      requestKey: 'new-worker',
      routing: 'fallback',
    });
    const newJobs = await jobsOf(database, newMessage.id);
    expect(newJobs).toHaveLength(2);
    for (const job of newJobs) expect(job).not.toHaveProperty('deliveryKey');
    const legacyReads = await db
      .select()
      .from(legacyJobs)
      .where(eq(legacyJobs.messageId, newMessage.id));
    expect(legacyReads).toHaveLength(2);
    for (const job of legacyReads) expect(job.deliveryKey).toBe('initial');
  });

  it('replays safely and enforces uniqueness even for different legacy delivery keys', async () => {
    const { database, db } = context;
    await migrate(db, { migrationsFolder });
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
    const legacyDuplicate = await db
      .insert(legacyJobs)
      .values({ ...originalJobs[0], deliveryKey: 'retry', id: undefined })
      .onConflictDoNothing()
      .returning();
    expect(legacyDuplicate).toEqual([]);
    expect(await jobsOf(database, messageId)).toEqual(expect.arrayContaining(originalJobs));
    expect(await jobsOf(database, messageId)).toHaveLength(2);
  });

  it('rolls back the migration without losing the old index or jobs when pairs are duplicated', async () => {
    const { client, db } = context;
    await db.insert(legacyJobs).values({ ...originalJobs[0], deliveryKey: 'retry', id: undefined });
    const jobsBefore = await db.select().from(legacyJobs).orderBy(legacyJobs.id);
    expect(jobsBefore).toHaveLength(3);
    const indexQuery = `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'channel_jobs_delivery_unique'`;
    const indexBefore = await client.query(indexQuery);
    const historyBefore = await client.query(
      'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
    );

    await expect(migrate(db, { migrationsFolder })).rejects.toMatchObject({
      cause: { code: '23505' },
    });

    expect((await client.query(indexQuery)).rows).toEqual(indexBefore.rows);
    expect(await db.select().from(legacyJobs).orderBy(legacyJobs.id)).toEqual(jobsBefore);
    expect(
      (await client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,
    ).toEqual(historyBefore.rows);
  });

  it('does not depend on the retained column after a later physical cleanup', async () => {
    const { client, database, db } = context;
    await migrate(db, { migrationsFolder });
    // Simulate the later contract release only in this isolated PGlite database.
    await client.exec('ALTER TABLE channel_jobs DROP COLUMN IF EXISTS delivery_key');
    const message = await team.asOwner.send(team.channel.id, {
      content: 'After the old binaries have retired',
      requestKey: 'after-cleanup',
      routing: 'fallback',
    });
    expect(await jobsOf(database, message.id)).toHaveLength(2);
  });
});
