// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

// `queryForVisitor` is read under the CREATOR's account scope (agent-share
// visitor reads run `new MessageModel(db, share.ownerId)`), matching the
// production shareChat.ts caller.
const creatorId = 'visitor-dto-creator';
const visitorId = 'visitor-dto-visitor';
const testUserIds = [creatorId, visitorId];

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, testUserIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([
    {
      id: creatorId,
      avatar: 'https://example.com/creator-avatar.png',
      fullName: 'Creator Full Name',
      username: 'creator-handle',
    },
    { id: visitorId },
  ]);
});

afterEach(cleanup);

describe('MessageModel.queryForVisitor', () => {
  it('never forwards the creator sender identity or spend/model snapshot', async () => {
    const topicId = 'visitor-dto-topic';
    await serverDB.insert(topics).values({
      id: topicId,
      title: 'Share topic',
      userId: creatorId,
      senderId: visitorId,
    });
    await serverDB.insert(messages).values([
      {
        id: 'visitor-dto-user-message',
        content: 'hello agent',
        createdAt: new Date('2026-01-01'),
        role: 'user',
        topicId,
        userId: creatorId,
      },
      {
        id: 'visitor-dto-assistant-message',
        content: 'hello human',
        createdAt: new Date('2026-01-02'),
        model: 'gpt-4',
        provider: 'openai',
        role: 'assistant',
        topicId,
        usage: { totalTokens: 999 } as any,
        userId: creatorId,
      },
    ]);

    // Mirrors shareChat.ts: the model is scoped to the CREATOR's account.
    const creatorScopedModel = new MessageModel(serverDB, creatorId);
    const result = await creatorScopedModel.queryForVisitor({ topicId });

    expect(result).toHaveLength(2);
    for (const message of result) {
      // The creator's account identity must never cross the share boundary.
      expect(message.sender).toBeNull();
      expect(message.usage).toBeUndefined();
      expect(message.extra?.model).toBeUndefined();
      expect(message.extra?.provider).toBeUndefined();
    }

    // Visitor-facing rendering fields survive the redaction.
    const userMessage = result.find((item) => item.id === 'visitor-dto-user-message');
    const assistantMessage = result.find((item) => item.id === 'visitor-dto-assistant-message');
    expect(userMessage?.content).toBe('hello agent');
    expect(userMessage?.role).toBe('user');
    expect(assistantMessage?.content).toBe('hello human');
    expect(assistantMessage?.role).toBe('assistant');
  });

  it('still exposes the creator identity through the raw query() path (regression guard)', async () => {
    // Guards the premise of the fix above: without `queryForVisitor`, `query()`
    // hydrates the creator's account into `sender` — this is the vulnerable
    // path shareChat.ts must never call directly for visitor reads.
    const topicId = 'visitor-dto-raw-topic';
    await serverDB.insert(topics).values({
      id: topicId,
      title: 'Share topic',
      userId: creatorId,
      senderId: visitorId,
    });
    await serverDB.insert(messages).values({
      id: 'visitor-dto-raw-message',
      content: 'hello agent',
      createdAt: new Date('2026-01-01'),
      role: 'user',
      topicId,
      userId: creatorId,
    });

    const creatorScopedModel = new MessageModel(serverDB, creatorId);
    const [rawMessage] = await creatorScopedModel.query({ topicId });

    expect(rawMessage.sender).toEqual({
      avatar: 'https://example.com/creator-avatar.png',
      fullName: 'Creator Full Name',
      id: creatorId,
      username: 'creator-handle',
    });
  });
});
