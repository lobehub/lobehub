// @vitest-environment node
import { eq } from 'drizzle-orm';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as schema from '../../../schemas';
import { messagePlugins, messages, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'plugins-for-op-user';
const otherUserId = 'plugins-for-op-other';
const messageModel = new MessageModel(serverDB, userId);

const T0 = new Date('2026-07-20T00:00:00.000Z');
const T1 = new Date('2026-07-20T00:01:00.000Z');
const T2 = new Date('2026-07-20T00:02:00.000Z');
const T3 = new Date('2026-07-20T00:03:00.000Z');

/** Insert a `tool` message + its plugin row with full control over createdAt. */
const seedToolCall = async (opts: {
  apiName?: string;
  createdAt: Date;
  id: string;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  threadId?: string | null;
  toolCallId?: string;
  topicId: string;
}) => {
  const owner = opts.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: '',
    createdAt: opts.createdAt,
    id: opts.id,
    metadata: opts.metadata,
    role: 'tool',
    threadId: opts.threadId ?? null,
    topicId: opts.topicId,
    userId: owner,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: opts.apiName ?? 'writeFile',
    arguments: JSON.stringify({ path: `/mnt/data/${opts.id}.pptx` }),
    id: opts.id,
    identifier: 'lobe-cloud-sandbox',
    state: { path: `/mnt/data/${opts.id}.pptx`, success: true },
    toolCallId: opts.toolCallId ?? `tc-${opts.id}`,
    userId: owner,
  });
};

const isServerDB = process.env.TEST_SERVER_DB === '1';

interface CapturedStatement {
  params: unknown[];
  sql: string;
}

/**
 * Run `run` against a drizzle instance layered over the SAME underlying client as
 * `serverDB` (so it sees the rows seeded through `serverDB`) but with a query
 * logger attached, and return every SQL statement (with its bound params) it
 * emitted. We re-`EXPLAIN` those exact statements to assert the *plan*, which is
 * the only thing that reveals the degradation — row results are identical whether
 * the predicates are OR-ed or split.
 */
const captureEmittedSql = async (
  run: (db: LobeChatDatabase) => Promise<void>,
): Promise<CapturedStatement[]> => {
  const captured: CapturedStatement[] = [];
  const logger = {
    logQuery: (sql: string, params: unknown[]) => captured.push({ params, sql }),
  };
  const client = (serverDB as unknown as { $client: { waitReady?: unknown } }).$client;
  const db = (
    'waitReady' in (client ?? {})
      ? pgliteDrizzle({ client: client as any, logger, schema })
      : nodeDrizzle(client as any, { logger, schema })
  ) as unknown as LobeChatDatabase;
  await run(db);
  return captured;
};

/** Rows the executor had to *examine* on `relation` (output + filtered-out,
 *  times loops) — the signal a full-table scan of it leaks. */
const rowsExaminedOn = (node: any, relation: string): number => {
  let total = 0;
  if (node?.['Relation Name'] === relation) {
    const loops = node['Actual Loops'] ?? 1;
    total += ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * loops;
  }
  for (const child of node?.Plans ?? []) total += rowsExaminedOn(child, relation);
  return total;
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'topic1', userId },
    { id: 'topic2', userId },
  ]);
  await serverDB
    .insert(threads)
    .values([{ id: 'thread1', topicId: 'topic1', type: 'continuation', userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.listMessagePluginsForOperation', () => {
  it('returns tool calls inside the time window, ordered by createdAt', async () => {
    await seedToolCall({ createdAt: T2, id: 'm-b', threadId: 'thread1', topicId: 'topic1' });
    await seedToolCall({ createdAt: T1, id: 'm-a', threadId: 'thread1', topicId: 'topic1' });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T3,
      operationId: 'op-1',
      startedAt: T0,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(rows.map((r) => r.id)).toEqual(['m-a', 'm-b']);
    expect(rows[0]).toMatchObject({ apiName: 'writeFile', identifier: 'lobe-cloud-sandbox' });
    expect(rows[0].createdAt.getTime()).toBe(T1.getTime());
  });

  it('excludes tool calls outside the [startedAt, completedAt] window', async () => {
    // createdAt earlier than the window start.
    await seedToolCall({ createdAt: T0, id: 'before', threadId: 'thread1', topicId: 'topic1' });
    // createdAt later than the window end.
    await seedToolCall({ createdAt: T3, id: 'after', threadId: 'thread1', topicId: 'topic1' });
    await seedToolCall({ createdAt: T2, id: 'inside', threadId: 'thread1', topicId: 'topic1' });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T2,
      operationId: 'op-1',
      startedAt: T1,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(rows.map((r) => r.id)).toEqual(['inside']);
  });

  it('scopes the window to the same topic and thread', async () => {
    await seedToolCall({ createdAt: T1, id: 'right', threadId: 'thread1', topicId: 'topic1' });
    // Same time window, different topic — must not leak in.
    await seedToolCall({ createdAt: T1, id: 'other-topic', threadId: null, topicId: 'topic2' });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T3,
      operationId: 'op-1',
      startedAt: T0,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(rows.map((r) => r.id)).toEqual(['right']);
  });

  it('matches heterogeneous rows by operation metadata even outside the window', async () => {
    // createdAt sits well after the window, but the metadata op-id must still match.
    await seedToolCall({
      createdAt: new Date('2027-01-01T00:00:00.000Z'),
      id: 'hetero',
      metadata: { heterogeneousToolStateOperationId: 'op-1' },
      threadId: 'thread1',
      topicId: 'topic1',
    });

    const rows = await messageModel.listMessagePluginsForOperation({
      completedAt: T3,
      operationId: 'op-1',
      startedAt: T0,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(rows.map((r) => r.id)).toEqual(['hetero']);
  });

  it('falls back to now when completedAt is omitted', async () => {
    await seedToolCall({
      createdAt: new Date(),
      id: 'recent',
      threadId: 'thread1',
      topicId: 'topic1',
    });

    const rows = await messageModel.listMessagePluginsForOperation({
      operationId: 'op-1',
      startedAt: T0,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(rows.map((r) => r.id)).toEqual(['recent']);
  });

  it('is scoped to the owning user', async () => {
    await seedToolCall({
      createdAt: T1,
      id: 'mine',
      ownerId: userId,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    const asOther = await new MessageModel(serverDB, otherUserId).listMessagePluginsForOperation({
      completedAt: T3,
      operationId: 'op-1',
      startedAt: T0,
      threadId: 'thread1',
      topicId: 'topic1',
    });

    expect(asOther).toEqual([]);
  });

  // Query-plan regression — the accurate guard. It reproduces the actual
  // degradation (a full scan of the user's whole plugin history) on a seeded skew
  // and asserts NO branch ever walks more than a handful of the user's plugin
  // rows. This catches every historical form of the bug: the original
  // `OR`-ed WHERE, and the later single-JOIN heterogeneous branch — both had the
  // planner scan/nested-loop all of `message_plugins` (100s+ per call). The fix
  // keeps `message_plugins` access PK-bounded in both branches (topic window joins
  // by PK; heterogeneous match resolves message ids first, then fetches by PK).
  //
  // Gated to the server DB (real Postgres): PGlite's planner picks a *different*,
  // already-fast plan, so the regression is invisible there — a plan assertion on
  // PGlite would be a false green. CI runs this suite against real Postgres via
  // `vitest.config.server.mts` (TEST_SERVER_DB=1).
  //
  // Why the plan and not the SQL shape: the row results are identical across all
  // three forms, and a "no OR()/no JOIN" text assertion breaks on innocent
  // rewrites. Plugin-rows-examined is what actually matters.
  describe.skipIf(!isServerDB)('query-plan regression (real Postgres only)', () => {
    const NOISE = 2000;

    it('never scans the whole plugin history in any branch', async () => {
      // Skew: NOISE plugin rows in a *different* topic (topic2) the query must
      // never touch, plus a few in-window rows and one heterogeneous row far
      // outside the window in the target topic (topic1).
      const noiseMessages = Array.from({ length: NOISE }, (_, i) => ({
        content: '',
        createdAt: new Date(Date.UTC(2020, 0, 1) + i * 1000),
        id: `noise-${i}`,
        role: 'tool' as const,
        topicId: 'topic2',
        userId,
      }));
      await serverDB.insert(messages).values(noiseMessages);
      await serverDB.insert(messagePlugins).values(
        noiseMessages.map((m) => ({
          apiName: 'writeFile',
          id: m.id,
          toolCallId: `tc-${m.id}`,
          userId,
        })),
      );
      await seedToolCall({ createdAt: T1, id: 'in-window', threadId: 'thread1', topicId: 'topic1' });
      await seedToolCall({ createdAt: T2, id: 'in-window-2', threadId: 'thread1', topicId: 'topic1' });
      await seedToolCall({
        createdAt: new Date('2027-01-01T00:00:00.000Z'),
        id: 'hetero',
        metadata: { heterogeneousToolStateOperationId: 'op-1' },
        threadId: 'thread1',
        topicId: 'topic1',
      });

      const pool = (
        serverDB as unknown as {
          $client: { query: (config: unknown) => Promise<{ rows: any[] }> };
        }
      ).$client;
      await pool.query('ANALYZE messages');
      await pool.query('ANALYZE message_plugins');

      // Capture the exact statements the method issues, faithfully.
      const statements = await captureEmittedSql(async (db) => {
        const rows = await new MessageModel(db, userId).listMessagePluginsForOperation({
          completedAt: T3,
          operationId: 'op-1',
          startedAt: T0,
          threadId: 'thread1',
          topicId: 'topic1',
        });
        // Correctness still holds across both branches under the skew.
        expect(rows.map((r) => r.id).sort()).toEqual(['hetero', 'in-window', 'in-window-2']);
      });

      // Any statement that JOINs message_plugins to messages must stay bounded —
      // it must not walk ~all of the user's history on EITHER table. That is the
      // exact regression: the original OR-ed WHERE and the later single-JOIN
      // heterogeneous branch both resolved the jsonb match *inside* the plugin
      // JOIN, so the planner scanned every plugin (or every message) the user owns
      // — whichever side it chose to drive from. The fix resolves that match in a
      // messages-ONLY lookup, which is excluded here (it never references
      // message_plugins) and is the partial index's job in a follow-up; the only
      // JOINs that remain are keyed by primary key.
      const joinStatements = statements.filter(
        (s) => /"message_plugins"/i.test(s.sql) && /"messages"/i.test(s.sql),
      );
      expect(
        joinStatements.length,
        'no message_plugins⋈messages statement was emitted — did the method stop returning plugin rows?',
      ).toBeGreaterThan(0);

      for (const statement of joinStatements) {
        const explained = await pool.query({
          text: `EXPLAIN (ANALYZE, FORMAT JSON) ${statement.sql}`,
          values: statement.params,
        });
        const plan = explained.rows[0]['QUERY PLAN'][0].Plan;
        const examined = rowsExaminedOn(plan, 'messages') + rowsExaminedOn(plan, 'message_plugins');
        expect(
          examined,
          `a message_plugins⋈messages statement examined ${examined} rows — it walked ~all of the user's ${NOISE}-row history instead of a bounded/PK access. A jsonb metadata match was resolved inside the plugin JOIN.`,
        ).toBeLessThan(NOISE / 2);
      }
    });
  });
});
