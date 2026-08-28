// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agents, messages, topics, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ExpertiseIngestionService } from './ingestion';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'expertise-history-user';
const otherUserId = 'expertise-history-other-user';

const seed = async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: 'hist-agent', userId },
    { id: 'hist-other-agent', userId },
    { id: 'hist-foreign-agent', userId: otherUserId },
  ]);
  await serverDB.insert(topics).values([
    // Messages carry the agent explicitly.
    { agentId: 'hist-agent', id: 'topic-explicit', title: 'explicit', userId },
    // Legacy rows: only the topic knows which agent it belongs to.
    { agentId: 'hist-agent', id: 'topic-legacy', title: 'legacy', userId },
    // Another agent's topic — must not count.
    { agentId: 'hist-other-agent', id: 'topic-other', title: 'other', userId },
    // Same agent id, but a foreign user's data — must not count.
    { agentId: 'hist-agent', id: 'topic-foreign', title: 'foreign', userId: otherUserId },
    // Agent's topic with no messages at all — nothing to read, must not count.
    { agentId: 'hist-agent', id: 'topic-empty', title: 'empty', userId },
  ]);
  await serverDB.insert(messages).values([
    {
      agentId: 'hist-agent',
      content: 'a',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: 'msg-explicit-1',
      role: 'user',
      topicId: 'topic-explicit',
      userId,
    },
    {
      agentId: 'hist-agent',
      content: 'b',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      id: 'msg-explicit-2',
      role: 'assistant',
      topicId: 'topic-explicit',
      userId,
    },
    {
      content: 'legacy',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      id: 'msg-legacy-1',
      role: 'user',
      topicId: 'topic-legacy',
      userId,
    },
    {
      agentId: 'hist-other-agent',
      content: 'other',
      createdAt: new Date('2026-01-04T00:00:00Z'),
      id: 'msg-other-1',
      role: 'user',
      topicId: 'topic-other',
      userId,
    },
    {
      agentId: 'hist-agent',
      content: 'foreign',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      id: 'msg-foreign-1',
      role: 'user',
      topicId: 'topic-foreign',
      userId: otherUserId,
    },
    // Topic-less message from the agent — cannot be warmed up from.
    {
      agentId: 'hist-agent',
      content: 'no topic',
      createdAt: new Date('2026-01-06T00:00:00Z'),
      id: 'msg-no-topic',
      role: 'user',
      userId,
    },
  ]);
};

describe('ExpertiseIngestionService historical topic resolution', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await seed();
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('counts topics reachable through either the message agent or the legacy topic agent', async () => {
    const service = new ExpertiseIngestionService(serverDB, userId);

    await expect(service.countHistoricalTopics('hist-agent')).resolves.toBe(2);
    await expect(service.countHistoricalTopics('hist-other-agent')).resolves.toBe(1);
    await expect(service.countHistoricalTopics('hist-foreign-agent')).resolves.toBe(0);
  });

  it('lists the same topics ordered by last activity with a stable cursor', async () => {
    const service = new ExpertiseIngestionService(serverDB, userId);

    const firstPage = await service.listHistoricalTopics('hist-agent', { limit: 1 });
    expect(firstPage.map((t) => t.topicId)).toEqual(['topic-legacy']);

    const secondPage = await service.listHistoricalTopics('hist-agent', {
      cursor: { lastActivityAt: firstPage[0].lastActivityAt!, topicId: firstPage[0].topicId },
      limit: 1,
    });
    expect(secondPage.map((t) => t.topicId)).toEqual(['topic-explicit']);

    const thirdPage = await service.listHistoricalTopics('hist-agent', {
      cursor: { lastActivityAt: secondPage[0].lastActivityAt!, topicId: secondPage[0].topicId },
      limit: 1,
    });
    expect(thirdPage).toEqual([]);
  });

  it('scopes workspace queries to workspace messages only', async () => {
    await serverDB
      .update(messages)
      .set({ workspaceId: null })
      .where(eq(messages.topicId, 'topic-explicit'));
    const service = new ExpertiseIngestionService(serverDB, userId, 'ws-that-has-nothing');

    await expect(service.countHistoricalTopics('hist-agent')).resolves.toBe(0);
  });
});
