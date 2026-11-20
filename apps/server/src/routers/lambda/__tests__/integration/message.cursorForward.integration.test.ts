// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { chatGroups, messages, topics, topicShares } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      deleteFile: vi.fn().mockResolvedValue(undefined),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      getFileAccessUrl: vi.fn().mockResolvedValue('mock-url'),
      getFullFileUrl: vi.fn().mockResolvedValue('mock-url'),
    };
  }),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

describe('message.getMessagesByCursor direction', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  const seedTwoRounds = async (topicId: string, groupId?: string) => {
    await serverDB.insert(messages).values(
      [
        ['fwd-u1', 'user', '2024-01-01T00:00:00.000Z'],
        ['fwd-a1', 'assistant', '2024-01-01T00:00:01.000Z'],
        ['fwd-u2', 'user', '2024-01-01T00:00:02.000Z'],
        ['fwd-a2', 'assistant', '2024-01-01T00:00:03.000Z'],
      ].map(([id, role, at]) => ({
        content: id,
        createdAt: new Date(at),
        groupId,
        id,
        role,
        topicId,
        userId,
      })),
    );
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('pages forward from the first round and echoes the direction', async () => {
    const [topic] = await serverDB.insert(topics).values({ userId }).returning();
    await seedTwoRounds(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const first = await caller.getMessagesByCursor({
      direction: 'forward',
      roundLimit: 1,
      topicId: topic.id,
    });
    const second = await caller.getMessagesByCursor({
      cursor: first.nextCursor,
      direction: 'forward',
      roundLimit: 1,
      topicId: topic.id,
    });

    expect(first.direction).toBe('forward');
    expect(first.messages.map((m) => m.id)).toEqual(['fwd-u1', 'fwd-a1']);
    expect(second.messages.map((m) => m.id)).toEqual(['fwd-u2', 'fwd-a2']);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps backward as the default and says so', async () => {
    const [topic] = await serverDB.insert(topics).values({ userId }).returning();
    await seedTwoRounds(topic.id);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const page = await caller.getMessagesByCursor({ roundLimit: 1, topicId: topic.id });

    expect(page.direction).toBe('backward');
    expect(page.messages.map((m) => m.id)).toEqual(['fwd-u2', 'fwd-a2']);
  });

  it("reads a group share from its share id alone, using the topic's own group", async () => {
    const [group] = await serverDB.insert(chatGroups).values({ userId }).returning();
    const [topic] = await serverDB.insert(topics).values({ groupId: group.id, userId }).returning();
    await seedTwoRounds(topic.id, group.id);
    const [share] = await serverDB
      .insert(topicShares)
      .values({ topicId: topic.id, userId, visibility: 'link' })
      .returning();
    const visitorId = await createTestUser(serverDB);
    const caller = messageRouter.createCaller(createTestContext(visitorId));

    const page = await caller.getMessagesByCursor({
      direction: 'forward',
      topicShareId: share.id,
    });

    expect(page.messages.map((m) => m.id)).toEqual(['fwd-u1', 'fwd-a1', 'fwd-u2', 'fwd-a2']);

    await cleanupTestUser(serverDB, visitorId);
  });
});
