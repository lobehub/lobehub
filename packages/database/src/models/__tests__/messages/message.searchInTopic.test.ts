import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-search-in-topic-test';
const otherUserId = 'message-search-in-topic-test-other';
const messageModel = new MessageModel(serverDB, userId);

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.delete(users).where(eq(users.id, otherUserId));
    await trx.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await trx.insert(topics).values([
      { id: 'topic-a', userId },
      { id: 'topic-b', userId },
      { id: 'topic-other', userId: otherUserId },
    ]);
    await trx.insert(threads).values({
      id: 'thread-a',
      topicId: 'topic-a',
      type: 'standalone',
      userId,
    });
    await trx.insert(messages).values([
      {
        content: 'How do I deploy?',
        createdAt: at(1),
        id: 'm1',
        role: 'user',
        topicId: 'topic-a',
        userId,
      },
      {
        content: 'Run `bun deploy`, then DEPLOY again.',
        createdAt: at(2),
        id: 'm2',
        role: 'assistant',
        topicId: 'topic-a',
        userId,
      },
      {
        content: 'deploy tool output',
        createdAt: at(3),
        id: 'm3',
        role: 'tool',
        topicId: 'topic-a',
        userId,
      },
      {
        content: 'deploy inside a thread',
        createdAt: at(4),
        id: 'm4',
        role: 'user',
        threadId: 'thread-a',
        topicId: 'topic-a',
        userId,
      },
      {
        content: 'deploy elsewhere',
        createdAt: at(5),
        id: 'm5',
        role: 'user',
        topicId: 'topic-b',
        userId,
      },
      {
        content: '100% done_now',
        createdAt: at(6),
        id: 'm6',
        role: 'user',
        topicId: 'topic-a',
        userId,
      },
      {
        content: '100x doneXnow',
        createdAt: at(7),
        id: 'm7',
        role: 'user',
        topicId: 'topic-a',
        userId,
      },
      {
        content: 'deploy by someone else',
        createdAt: at(8),
        id: 'm8',
        role: 'user',
        topicId: 'topic-other',
        userId: otherUserId,
      },
    ]);
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.searchInTopic', () => {
  it('finds case-insensitive mainline matches of one topic, oldest first', async () => {
    const result = await messageModel.searchInTopic({ keyword: 'Deploy', topicId: 'topic-a' });

    expect(result.map(({ id, matchCount, role }) => ({ id, matchCount, role }))).toEqual([
      { id: 'm1', matchCount: 1, role: 'user' },
      { id: 'm2', matchCount: 2, role: 'assistant' },
    ]);
    expect(result[1].snippet).toBe('Run `bun deploy`, then DEPLOY again.');
  });

  it('matches LIKE metacharacters literally', async () => {
    expect(
      (await messageModel.searchInTopic({ keyword: '0% done_', topicId: 'topic-a' })).map(
        (match) => match.id,
      ),
    ).toEqual(['m6']);
  });

  it('never reads another user topic', async () => {
    expect(await messageModel.searchInTopic({ keyword: 'deploy', topicId: 'topic-other' })).toEqual(
      [],
    );
  });

  it('returns nothing for a blank keyword and honors the limit', async () => {
    expect(await messageModel.searchInTopic({ keyword: '   ', topicId: 'topic-a' })).toEqual([]);
    expect(
      await messageModel.searchInTopic({ keyword: 'deploy', limit: 1, topicId: 'topic-a' }),
    ).toHaveLength(1);
  });
});
