// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'thread-transcript-user';
const otherUserId = 'thread-transcript-other-user';
const testUserIds = [userId, otherUserId];

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, testUserIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('MessageModel.queryThreadTranscript', () => {
  it('returns only the requested thread’s messages with stable pagination', async () => {
    const topicId = 'thread-transcript-topic';
    const threadId = 'thread-transcript-target';
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    await serverDB.insert(topics).values({ id: topicId, title: 'Thread transcript', userId });
    await serverDB.insert(threads).values([
      { id: threadId, topicId, type: 'isolation', userId },
      { id: 'thread-transcript-other', topicId, type: 'isolation', userId },
    ]);
    await serverDB.insert(messages).values([
      {
        content: 'thread user',
        createdAt,
        id: 'thread-m-a',
        role: 'user',
        threadId,
        topicId,
        userId,
      },
      {
        content: 'thread assistant',
        createdAt,
        id: 'thread-m-b',
        role: 'assistant',
        threadId,
        topicId,
        userId,
      },
      // A different thread in the SAME topic must be excluded.
      {
        content: 'other thread',
        createdAt,
        id: 'thread-m-other',
        role: 'assistant',
        threadId: 'thread-transcript-other',
        topicId,
        userId,
      },
      // A mainline message (no threadId) must be excluded.
      { content: 'mainline', createdAt, id: 'thread-m-main', role: 'user', topicId, userId },
      // Another owner's message in the same thread must be excluded.
      {
        content: 'other owner',
        createdAt,
        id: 'thread-m-owner',
        role: 'user',
        threadId,
        topicId,
        userId: otherUserId,
      },
    ]);

    const model = new MessageModel(serverDB, userId);
    const full = await model.queryThreadTranscript({ limit: 10, offset: 0, threadId });

    expect(full.total).toBe(2);
    expect(full.items.map(({ id }) => id)).toEqual(['thread-m-a', 'thread-m-b']);

    const page = await model.queryThreadTranscript({ limit: 1, offset: 1, threadId });
    expect(page.total).toBe(2);
    expect(page.items.map(({ id }) => id)).toEqual(['thread-m-b']);
  });
});
