// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { messages, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageRouter } from '../../message';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFileAccessUrl: vi.fn().mockResolvedValue('mock-url') };
  }),
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

describe('message.searchInTopic', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    otherUserId = await createTestUser(serverDB);
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    await cleanupTestUser(serverDB, otherUserId);
  });

  it('returns the matches of a topic the caller can read', async () => {
    const [topic] = await serverDB.insert(topics).values({ userId }).returning();
    await serverDB.insert(messages).values([
      { content: 'first question', id: 'find-u1', role: 'user', topicId: topic.id, userId },
      { content: 'an answer', id: 'find-a1', role: 'assistant', topicId: topic.id, userId },
    ]);
    const caller = messageRouter.createCaller(createTestContext(userId));

    const result = await caller.searchInTopic({ keyword: 'QUESTION', topicId: topic.id });

    expect(result.map((match) => match.id)).toEqual(['find-u1']);
  });

  it('finds nothing in a topic that belongs to someone else', async () => {
    const [topic] = await serverDB.insert(topics).values({ userId: otherUserId }).returning();
    await serverDB.insert(messages).values({
      content: 'private question',
      role: 'user',
      topicId: topic.id,
      userId: otherUserId,
    });
    const caller = messageRouter.createCaller(createTestContext(userId));

    expect(await caller.searchInTopic({ keyword: 'question', topicId: topic.id })).toEqual([]);
  });
});
