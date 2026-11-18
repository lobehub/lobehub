import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-memory-extractor-user';
const otherUserId = 'topic-memory-extractor-other-user';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - countTopicsForMemoryExtractor', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('counts only topics with conversation left to extract when ignoreExtracted is false', async () => {
    await serverDB.insert(topics).values([
      { id: 't1', createdAt: new Date('2023-01-01'), metadata: {}, userId },
      {
        id: 't2',
        createdAt: new Date('2023-02-01'),
        metadata: {
          userMemoryExtractRunState: { extractedThrough: '2023-02-02T00:00:00.000Z' },
          userMemoryExtractStatus: 'completed',
        },
        userId,
      },
      { id: 't3', createdAt: new Date('2023-03-01'), metadata: {}, userId },
      // No conversation at all: nothing to extract.
      { id: 't4-empty', createdAt: new Date('2023-03-02'), metadata: {}, userId },
    ]);
    await serverDB.insert(messages).values([
      {
        content: 'hi',
        createdAt: new Date('2023-01-02'),
        id: 'm1',
        role: 'user',
        topicId: 't1',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-02-02'),
        id: 'm2',
        role: 'user',
        topicId: 't2',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-03-02'),
        id: 'm3',
        role: 'assistant',
        topicId: 't3',
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: false,
    });

    expect(total).toBe(2);
  });

  it('includes extracted topics when ignoreExtracted is true', async () => {
    await serverDB.insert(topics).values([
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      {
        id: 't2',
        createdAt: new Date('2023-02-01'),
        metadata: {
          userMemoryExtractStatus: 'completed',
        },
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: true,
    });

    expect(total).toBe(2);
  });

  it('excludes agent-share visitor topics from the count', async () => {
    await serverDB.insert(topics).values([
      // normal creator topic — kept
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      // agent-share visitor topic: userId is still the creator, but senderId
      // marks it as a visitor conversation that must not feed memory extraction
      {
        id: 't2-visitor',
        createdAt: new Date('2023-01-02'),
        metadata: {},
        senderId: 'visitor-user-x',
        userId,
      },
    ]);

    const total = await topicModel.countTopicsForMemoryExtractor({
      ignoreExtracted: true,
    });

    expect(total).toBe(1);
  });
});

describe('TopicModel - listTopicsForMemoryExtractor', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('excludes agent-share visitor topics from the list', async () => {
    await serverDB.insert(topics).values([
      // normal creator topic — kept
      {
        id: 't1',
        createdAt: new Date('2023-01-01'),
        metadata: {},
        userId,
      },
      // agent-share visitor topic: userId is still the creator, but senderId
      // marks it as a visitor conversation that must not feed memory extraction
      {
        id: 't2-visitor',
        createdAt: new Date('2023-01-02'),
        metadata: {},
        senderId: 'visitor-user-x',
        userId,
      },
    ]);

    const result = await topicModel.listTopicsForMemoryExtractor({ ignoreExtracted: true });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });
});

describe('TopicModel - listTopicsForMemoryExtractor limitFailedRetries', () => {
  const failedRun = (lastRunAt: string, failedRuns?: number) => ({
    userMemoryExtractRunState: { failedRuns, lastRunAt },
    userMemoryExtractStatus: 'failed' as const,
  });
  const message = (id: string, topicId: string, createdAt: string) => ({
    content: 'hi',
    createdAt: new Date(createdAt),
    id,
    role: 'user' as const,
    topicId,
    userId,
  });

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(topics).values([
      { createdAt: new Date('2023-01-01'), id: 'pending', metadata: {}, userId },
      // Failed before the count existed: one failure so far, still within the budget.
      {
        createdAt: new Date('2023-01-02'),
        id: 'failed-uncounted',
        metadata: failedRun('2023-02-01T00:00:00.000Z'),
        userId,
      },
      {
        createdAt: new Date('2023-01-03'),
        id: 'failed-last-retry',
        metadata: failedRun('2023-02-01T00:00:00.000Z', 3),
        userId,
      },
      {
        createdAt: new Date('2023-01-04'),
        id: 'failed-exhausted',
        metadata: failedRun('2023-02-01T00:00:00.000Z', 4),
        userId,
      },
      // Out of retries, but the user kept talking after the failed run.
      {
        createdAt: new Date('2023-01-05'),
        id: 'failed-exhausted-active',
        metadata: failedRun('2023-02-01T00:00:00.000Z', 9),
        userId,
      },
    ]);
    await serverDB
      .insert(messages)
      .values([
        message('m-pending', 'pending', '2023-01-10'),
        message('m-uncounted', 'failed-uncounted', '2023-01-15'),
        message('m-last-retry', 'failed-last-retry', '2023-01-15'),
        message('m-exhausted', 'failed-exhausted', '2023-01-15'),
        message('m-active-old', 'failed-exhausted-active', '2023-01-15'),
        message('m-active-new', 'failed-exhausted-active', '2023-02-02'),
      ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('retries a failed topic until its automatic retries run out, then only after new messages', async () => {
    const result = await topicModel.listTopicsForMemoryExtractor({ limitFailedRetries: true });

    expect(result.map((topic) => topic.id)).toEqual([
      'pending',
      'failed-uncounted',
      'failed-last-retry',
      'failed-exhausted-active',
    ]);
  });

  it('keeps every unfinished topic when the option is off', async () => {
    const result = await topicModel.listTopicsForMemoryExtractor({});

    expect(result.map((topic) => topic.id)).toEqual([
      'pending',
      'failed-uncounted',
      'failed-last-retry',
      'failed-exhausted',
      'failed-exhausted-active',
    ]);
  });
});

describe('TopicModel - listTopicsForMemoryExtractor incremental extraction', () => {
  const completed = (state: Record<string, string>) => ({
    userMemoryExtractRunState: state,
    userMemoryExtractStatus: 'completed' as const,
  });

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(topics).values([
      {
        createdAt: new Date('2023-01-01'),
        id: 'new-user-message',
        metadata: completed({ extractedThrough: '2023-01-10T00:00:00.000Z' }),
        userId,
      },
      {
        createdAt: new Date('2023-01-02'),
        id: 'only-tool-output',
        metadata: completed({ extractedThrough: '2023-01-10T00:00:00.000Z' }),
        userId,
      },
      {
        createdAt: new Date('2023-01-03'),
        id: 'up-to-date',
        metadata: completed({ extractedThrough: '2023-01-10T00:00:00.000Z' }),
        userId,
      },
      {
        createdAt: new Date('2023-01-04'),
        // Completed before the watermark existed: its last run covered up to lastMessageAt.
        id: 'legacy-completed',
        metadata: completed({ lastMessageAt: '2023-01-10T00:00:00.000Z' }),
        userId,
      },
      {
        createdAt: new Date('2023-01-05'),
        id: 'still-being-written',
        metadata: {},
        userId,
      },
    ]);
    await serverDB.insert(messages).values([
      {
        content: 'hi',
        createdAt: new Date('2023-01-09'),
        id: 'a1',
        role: 'user',
        topicId: 'new-user-message',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-11'),
        id: 'a2',
        role: 'user',
        topicId: 'new-user-message',
        userId,
      },
      {
        createdAt: new Date('2023-01-11'),
        id: 'b1',
        role: 'tool',
        topicId: 'only-tool-output',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-09'),
        id: 'c1',
        role: 'assistant',
        topicId: 'up-to-date',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-10'),
        id: 'c2',
        role: 'user',
        topicId: 'up-to-date',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-10'),
        id: 'd1',
        role: 'user',
        topicId: 'legacy-completed',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-12'),
        id: 'd2',
        role: 'assistant',
        topicId: 'legacy-completed',
        userId,
      },
      {
        content: 'hi',
        createdAt: new Date('2023-01-20'),
        id: 'e1',
        role: 'user',
        topicId: 'still-being-written',
        userId,
      },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('picks up a completed topic again once user or assistant messages follow its watermark', async () => {
    const result = await topicModel.listTopicsForMemoryExtractor({
      settledBefore: new Date('2023-01-15'),
    });

    expect(result.map((topic) => topic.id)).toEqual(['new-user-message', 'legacy-completed']);
  });

  it('counts the same topics it lists', async () => {
    const total = await topicModel.countTopicsForMemoryExtractor({
      settledBefore: new Date('2023-01-15'),
    });

    expect(total).toBe(2);
  });

  it('treats the watermark as covering its own message despite microsecond timestamps', async () => {
    // Postgres keeps microseconds; the watermark is written from a JS Date, which keeps
    // milliseconds. The message the watermark points at must not count as new.
    await serverDB.insert(topics).values({
      createdAt: new Date('2023-01-06'),
      id: 'microseconds',
      metadata: completed({ extractedThrough: '2023-01-10T00:00:00.123Z' }),
      userId,
    });
    await serverDB.insert(messages).values({
      content: 'hi',
      createdAt: new Date('2023-01-10T00:00:00.123Z'),
      id: 'f1',
      role: 'user',
      topicId: 'microseconds',
      userId,
    });
    await serverDB.execute(
      sql`UPDATE ${messages} SET created_at = '2023-01-10T00:00:00.123456Z' WHERE id = 'f1'`,
    );

    const result = await topicModel.listTopicsForMemoryExtractor({
      settledBefore: new Date('2023-01-15'),
    });

    expect(result.map((topic) => topic.id)).not.toContain('microseconds');
  });

  it('does not count a newer message without text, which extraction skips', async () => {
    // Assistant turns that only called tools have empty content. Extraction drops them, so a
    // topic with nothing else new would be listed every hour without its watermark ever moving.
    await serverDB.insert(topics).values({
      createdAt: new Date('2023-01-06'),
      id: 'blank-only',
      metadata: completed({ extractedThrough: '2023-01-10T00:00:00.000Z' }),
      userId,
    });
    await serverDB.insert(messages).values([
      {
        content: '',
        createdAt: new Date('2023-01-11'),
        id: 'g1',
        role: 'assistant',
        topicId: 'blank-only',
        userId,
      },
      {
        content: '  \n',
        createdAt: new Date('2023-01-12'),
        id: 'g2',
        role: 'assistant',
        topicId: 'blank-only',
        userId,
      },
    ]);

    const result = await topicModel.listTopicsForMemoryExtractor({
      settledBefore: new Date('2023-01-15'),
    });

    expect(result.map((topic) => topic.id)).not.toContain('blank-only');
  });

  it('waits until a message settles before treating it as new', async () => {
    const result = await topicModel.listTopicsForMemoryExtractor({
      settledBefore: new Date('2023-01-25'),
    });

    expect(result.map((topic) => topic.id)).toContain('still-being-written');
  });
});

describe('TopicModel - listTopicsForMemoryExtractor pagination', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  // Only a topic with conversation left to extract is listed, so each fixture topic gets one.
  const insertUserMessages = (topicIds: string[]) =>
    serverDB.insert(messages).values(
      topicIds.map((topicId) => ({
        content: 'hi',
        createdAt: new Date('2025-06-01T00:00:00Z'),
        id: `msg-${topicId}`,
        role: 'user',
        topicId,
        userId,
      })),
    );

  it('should paginate pending topics and skip extracted ones by default', async () => {
    await serverDB.insert(topics).values([
      {
        createdAt: new Date('2024-01-01T00:00:00Z'),
        id: 't1',
        metadata: { userMemoryExtractStatus: 'completed' },
        userId,
      },
      { createdAt: new Date('2024-01-02T00:00:00Z'), id: 't2', userId },
      {
        createdAt: new Date('2024-01-03T00:00:00Z'),
        id: 't3',
        metadata: { userMemoryExtractStatus: 'pending' },
        userId,
      },
      { createdAt: new Date('2024-01-04T00:00:00Z'), id: 't4', userId: otherUserId },
    ] satisfies Array<typeof topics.$inferInsert>);
    await insertUserMessages(['t1', 't2', 't3']);

    // t1 is skipped because it has userMemoryExtractStatus: 'completed'
    // t4 is skipped because it belongs to a different user
    const page1 = await topicModel.listTopicsForMemoryExtractor({ limit: 1 });
    expect(page1.map((t) => t.id)).toEqual(['t2']);

    const page2 = await topicModel.listTopicsForMemoryExtractor({
      cursor: { createdAt: page1[0].createdAt, id: page1[0].id },
      limit: 5,
    });
    expect(page2.map((t) => t.id)).toEqual(['t3']);
  });

  it('should include extracted topics when ignoreExtracted is true', async () => {
    await serverDB.insert(topics).values([
      {
        createdAt: new Date('2024-02-01T00:00:00Z'),
        id: 'et1',
        metadata: { userMemoryExtractStatus: 'completed' },
        userId,
      },
      { createdAt: new Date('2024-02-02T00:00:00Z'), id: 'et2', userId },
    ] satisfies Array<typeof topics.$inferInsert>);

    const rows = await topicModel.listTopicsForMemoryExtractor({
      ignoreExtracted: true,
      limit: 10,
    });

    expect(rows.map((t) => t.id)).toEqual(['et1', 'et2']);
  });

  it('should paginate forward from the cursor, excluding items at or before it and including later ones', async () => {
    const createdAt = new Date('2025-01-20T18:43:33.603Z');

    await serverDB.insert(topics).values([
      // Before cursor
      { createdAt: new Date(createdAt.getTime() - 2), id: 'before-old', userId },
      { createdAt, id: 'before-same-timestamp', userId },
      // Cursor row
      { createdAt, id: 'cursor-topic', userId },
      // Same timestamp, after cursor by ID
      { createdAt, id: 'cursor-topic-z', userId },
      // Later timestamps
      { createdAt: new Date(createdAt.getTime() + 1), id: 'after-1', userId },
      { createdAt: new Date(createdAt.getTime() + 2), id: 'after-2', userId },
      // Different user should be ignored
      { createdAt: new Date(createdAt.getTime() + 3), id: 'other-user', userId: otherUserId },
    ] satisfies Array<typeof topics.$inferInsert>);
    await insertUserMessages([
      'before-old',
      'before-same-timestamp',
      'cursor-topic',
      'cursor-topic-z',
      'after-1',
      'after-2',
    ]);

    const rows = await topicModel.listTopicsForMemoryExtractor({
      cursor: { createdAt, id: 'cursor-topic' },
      limit: 10,
    });

    expect(rows.map((t) => t.id)).toEqual(['cursor-topic-z', 'after-1', 'after-2']);
  });

  it('pages through topics sharing a millisecond without repeating or skipping any', async () => {
    const ids = ['t-z', 't-a', 't-m'];
    await serverDB.insert(topics).values(ids.map((id) => ({ id, userId })));
    await insertUserMessages(ids);
    // Same millisecond, different microseconds, as rows written by SQL defaults keep.
    for (const [id, fraction] of Object.entries({
      't-a': '001900',
      't-m': '001290',
      't-z': '001200',
    })) {
      await serverDB.execute(
        sql`UPDATE ${topics} SET created_at = ${`2026-11-17T10:29:19.${fraction}Z`}::timestamptz WHERE id = ${id}`,
      );
    }

    const seen: string[] = [];
    let cursor: { createdAt: Date; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = await topicModel.listTopicsForMemoryExtractor({ cursor, limit: 1 });
      if (rows.length === 0) break;
      seen.push(...rows.map((t) => t.id));
      const last = rows.at(-1)!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    expect(seen).toEqual(['t-a', 't-m', 't-z']);
  });
});
