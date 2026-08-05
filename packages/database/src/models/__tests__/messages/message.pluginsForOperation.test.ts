// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
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
});
