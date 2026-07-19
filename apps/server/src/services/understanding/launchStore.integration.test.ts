// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentOperations,
  agents,
  messages,
  threads,
  topics,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { RequestTrigger, ThreadType } from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUnderstandingLaunchStore } from './launchStore';

const db: LobeChatDatabase = await getTestDB();
const userId = 'understanding-launch-user';
const otherUserId = 'understanding-launch-other';
const agentId = 'understanding-launch-agent';
const topicId = 'understanding-launch-topic';
const threadId = 'understanding-launch-thread';
const workspaceId = 'understanding-launch-workspace';
const identity = { agentId, kind: 'source' as const, threadId, topicId };

const insertAssistant = (
  id: string,
  createdAt: Date,
  overrides: Partial<typeof messages.$inferInsert> = {},
) =>
  db.insert(messages).values({
    agentId,
    content: 'loading',
    createdAt,
    id,
    role: 'assistant',
    threadId,
    topicId,
    userId,
    ...overrides,
  });

const insertOperation = (
  id: string,
  startedAt: Date,
  overrides: Partial<typeof agentOperations.$inferInsert> = {},
) =>
  db.insert(agentOperations).values({
    agentId,
    createdAt: startedAt,
    id,
    startedAt,
    status: 'running',
    threadId,
    topicId,
    trigger: RequestTrigger.Onboarding,
    userId,
    ...overrides,
  });

describe('UnderstandingLaunchStore durable recovery', () => {
  beforeEach(async () => {
    await db.delete(agentOperations).where(inArray(agentOperations.userId, [userId, otherUserId]));
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Understanding launch test',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await db.insert(agents).values({ id: agentId, userId });
    await db.insert(topics).values({ agentId, id: topicId, userId });
    await db.insert(threads).values({
      agentId,
      id: threadId,
      metadata: { onboardingUnderstanding: { kind: 'source' } },
      topicId,
      type: ThreadType.Isolation,
      userId,
    });
  });

  afterEach(async () => {
    await db.delete(agentOperations).where(inArray(agentOperations.userId, [userId, otherUserId]));
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  it('atomically claims one launch pair across concurrent store instances', async () => {
    const first = { assistantMessageId: 'assistant-first', operationId: 'operation-first' };
    const second = { assistantMessageId: 'assistant-second', operationId: 'operation-second' };

    const claimed = await Promise.all([
      createUnderstandingLaunchStore(db, userId).save(identity, first),
      createUnderstandingLaunchStore(db, userId).save(identity, second),
    ]);

    expect(claimed[0]).toEqual(claimed[1]);
    expect([first, second]).toContainEqual(claimed[0]);
    await expect(createUnderstandingLaunchStore(db, userId).find(identity)).resolves.toEqual(
      claimed[0],
    );
  });

  it('recovers an operation when neither the thread nor topic has a launch reference', async () => {
    await insertAssistant('assistant-before', new Date('2026-07-20T10:00:00.000Z'));
    await insertOperation('operation-after', new Date('2026-07-20T10:00:01.000Z'));

    const store = createUnderstandingLaunchStore(db, userId);

    await expect(store.find(identity)).resolves.toEqual({
      assistantMessageId: 'assistant-before',
      operationId: 'operation-after',
    });
    await expect(store.find(identity)).resolves.toEqual({
      assistantMessageId: 'assistant-before',
      operationId: 'operation-after',
    });
  });

  it('pairs the operation with the latest earlier assistant, not a later orphan', async () => {
    await insertAssistant('assistant-before', new Date('2026-07-20T10:00:00.000Z'));
    await insertOperation('operation', new Date('2026-07-20T10:00:01.000Z'));
    await insertAssistant('assistant-after', new Date('2026-07-20T10:00:02.000Z'));

    await expect(createUnderstandingLaunchStore(db, userId).find(identity)).resolves.toEqual({
      assistantMessageId: 'assistant-before',
      operationId: 'operation',
    });
  });

  it('uses the database creation clock when operation startedAt is skewed', async () => {
    await insertAssistant('assistant-before', new Date('2026-07-20T10:00:00.000Z'));
    await insertOperation('operation', new Date('2026-07-20T09:00:00.000Z'), {
      createdAt: new Date('2026-07-20T10:00:01.000Z'),
    });
    await insertAssistant('assistant-after', new Date('2026-07-20T10:00:02.000Z'));

    await expect(createUnderstandingLaunchStore(db, userId).find(identity)).resolves.toEqual({
      assistantMessageId: 'assistant-before',
      operationId: 'operation',
    });
  });

  it('uses the latest exact operation and its preceding assistant', async () => {
    await insertAssistant('assistant-old', new Date('2026-07-20T10:00:00.000Z'));
    await insertOperation('operation-old', new Date('2026-07-20T10:00:01.000Z'));
    await insertAssistant('assistant-latest', new Date('2026-07-20T10:00:02.000Z'));
    await insertOperation('operation-latest', new Date('2026-07-20T10:00:03.000Z'));

    await expect(createUnderstandingLaunchStore(db, userId).find(identity)).resolves.toEqual({
      assistantMessageId: 'assistant-latest',
      operationId: 'operation-latest',
    });
  });

  it.each([
    ['another owner', { userId: otherUserId }],
    ['a workspace', { workspaceId }],
    ['another agent', { agentId: null }],
    ['another topic', { topicId: null }],
    ['another thread', { threadId: null }],
    ['another trigger', { trigger: RequestTrigger.Chat }],
  ])('rejects an operation from %s', async (_label, overrides) => {
    await insertAssistant('assistant-before', new Date('2026-07-20T10:00:00.000Z'));
    await insertOperation('mismatched-operation', new Date('2026-07-20T10:00:01.000Z'), overrides);

    await expect(
      createUnderstandingLaunchStore(db, userId).find(identity),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['another owner', { userId: otherUserId }],
    ['a workspace', { workspaceId }],
    ['another agent', { agentId: null }],
    ['another topic', { topicId: null }],
    ['another thread', { threadId: null }],
  ])('rejects an assistant from %s', async (_label, overrides) => {
    await insertAssistant('mismatched-assistant', new Date('2026-07-20T10:00:00.000Z'), overrides);
    await insertOperation('operation', new Date('2026-07-20T10:00:01.000Z'));

    await expect(
      createUnderstandingLaunchStore(db, userId).find(identity),
    ).resolves.toBeUndefined();
  });
});
