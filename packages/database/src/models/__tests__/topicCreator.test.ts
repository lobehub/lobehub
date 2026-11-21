// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, topics, users } from '../../schemas';
import { TopicModel } from '../topic';

const db = await getTestDB();
const owner = 'topic-creator-owner';
const model = new TopicModel(db, owner);
const creator = {
  avatar: 'https://example.com/bot.png',
  fullName: 'LobehubBot',
  id: '123',
  platform: 'discord',
};
const bot = {
  applicationId: 'app',
  isOwner: false,
  platform: 'discord',
  platformThreadId: 'thread',
  senderExternalUserId: '456',
};

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: 'other-owner' }]);
  await db.insert(topics).values([
    { id: 'bot-topic', userId: owner, metadata: { bot } },
    { id: 'empty-topic', userId: owner, metadata: { bot } },
    { id: 'personal-topic', userId: owner },
    { id: 'foreign-topic', userId: 'other-owner', metadata: { bot } },
  ]);
  await db.insert(messages).values([
    {
      id: 'first',
      topicId: 'bot-topic',
      role: 'user',
      userId: owner,
      createdAt: new Date('2026-10-01'),
      metadata: { botSender: creator },
    },
    {
      id: 'second',
      topicId: 'bot-topic',
      role: 'user',
      userId: owner,
      createdAt: new Date('2026-10-02'),
      metadata: { botSender: { ...creator, id: '456', fullName: 'Later participant' } },
    },
    {
      id: 'foreign',
      topicId: 'foreign-topic',
      role: 'user',
      userId: 'other-owner',
      metadata: { botSender: creator },
    },
  ]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('topic creator list projection', () => {
  it.each(['sidebar', 'feed', 'feed-preview'] as const)(
    'returns the original sender in %s without leaking another owner',
    async (mode) => {
      const rows =
        mode === 'sidebar'
          ? (await model.query()).items
          : await model.queryTopics({ withLastMessage: mode === 'feed-preview' });
      expect(rows.find((row) => row.id === 'bot-topic')?.metadata?.botCreator).toEqual(creator);
      expect(rows.find((row) => row.id === 'empty-topic')?.metadata?.botCreator).toBeNull();
      expect(rows.find((row) => row.id === 'personal-topic')?.metadata?.botCreator).toBeUndefined();
      expect(rows.some((row) => row.id === 'foreign-topic')).toBe(false);
    },
  );
});
