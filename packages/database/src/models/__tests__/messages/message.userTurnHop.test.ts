// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'user-turn-hop-user';
const otherUserId = 'user-turn-hop-other';
const messageModel = new MessageModel(serverDB, userId);

const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 10, minute));

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'hop-topic', userId },
    { id: 'hop-other-topic', userId: otherUserId },
  ]);
  await serverDB
    .insert(threads)
    .values({ id: 'hop-thread', topicId: 'hop-topic', type: 'isolation', userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.findLatestUserTurnHop', () => {
  it('reads the hop of the newest user message, ignoring other roles', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'from an agent',
        createdAt: at(1),
        id: 'hop-1',
        metadata: { agentSender: { agentId: 'agt-a', hop: 2 } },
        role: 'user',
        topicId: 'hop-topic',
        userId,
      },
      {
        content: 'reply',
        createdAt: at(2),
        id: 'hop-2',
        role: 'assistant',
        topicId: 'hop-topic',
        userId,
      },
    ]);

    await expect(messageModel.findLatestUserTurnHop({ topicId: 'hop-topic' })).resolves.toBe(2);
  });

  it('is undefined once a person wrote the newest user message', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'from an agent',
        createdAt: at(1),
        id: 'hop-1',
        metadata: { agentSender: { agentId: 'agt-a', hop: 3 } },
        role: 'user',
        topicId: 'hop-topic',
        userId,
      },
      {
        content: 'typed',
        createdAt: at(2),
        id: 'hop-2',
        role: 'user',
        topicId: 'hop-topic',
        userId,
      },
    ]);

    await expect(
      messageModel.findLatestUserTurnHop({ topicId: 'hop-topic' }),
    ).resolves.toBeUndefined();
  });

  it('keeps the main transcript and a thread apart', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'main',
        createdAt: at(1),
        id: 'hop-main',
        metadata: { agentSender: { agentId: 'agt-a', hop: 1 } },
        role: 'user',
        topicId: 'hop-topic',
        userId,
      },
      {
        content: 'thread',
        createdAt: at(2),
        id: 'hop-thread-msg',
        metadata: { agentSender: { agentId: 'agt-a', hop: 4 } },
        role: 'user',
        threadId: 'hop-thread',
        topicId: 'hop-topic',
        userId,
      },
    ]);

    await expect(messageModel.findLatestUserTurnHop({ topicId: 'hop-topic' })).resolves.toBe(1);
    await expect(
      messageModel.findLatestUserTurnHop({ threadId: 'hop-thread', topicId: 'hop-topic' }),
    ).resolves.toBe(4);
  });

  it("does not read another user's conversation", async () => {
    await serverDB.insert(messages).values({
      content: 'theirs',
      id: 'hop-foreign',
      metadata: { agentSender: { agentId: 'agt-a', hop: 2 } },
      role: 'user',
      topicId: 'hop-other-topic',
      userId: otherUserId,
    });

    await expect(
      messageModel.findLatestUserTurnHop({ topicId: 'hop-other-topic' }),
    ).resolves.toBeUndefined();
  });
});
