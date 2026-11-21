// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'tool-calls-in-topics-user';
const otherUserId = 'tool-calls-in-topics-other';
const messageModel = new MessageModel(serverDB, userId);

const seedToolCall = async (opts: {
  apiName?: string;
  content: string;
  createdAt: Date;
  id: string;
  ownerId?: string;
  topicId: string;
}) => {
  const owner = opts.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: opts.content,
    createdAt: opts.createdAt,
    id: opts.id,
    role: 'tool',
    topicId: opts.topicId,
    userId: owner,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: opts.apiName ?? 'askUserQuestion',
    arguments: JSON.stringify({ questions: [{ question: opts.id }] }),
    id: opts.id,
    identifier: 'claude-code',
    toolCallId: `tc-${opts.id}`,
    userId: owner,
  });
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'tcit-round1', userId },
    { id: 'tcit-round2', userId },
    { id: 'tcit-unrelated', userId },
    { id: 'tcit-other', userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.listToolCallsInTopics', () => {
  it('returns the calls to one API across the given topics, oldest first', async () => {
    await seedToolCall({
      content: 'User answers:\n- q: yes',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      id: 'tcit-a',
      topicId: 'tcit-round1',
    });
    await seedToolCall({
      content: 'No answer received within the wait window',
      createdAt: new Date('2026-10-01T11:00:00Z'),
      id: 'tcit-b',
      topicId: 'tcit-round2',
    });
    await seedToolCall({
      apiName: 'Bash',
      content: 'ls',
      createdAt: new Date('2026-10-01T11:30:00Z'),
      id: 'tcit-bash',
      topicId: 'tcit-round2',
    });
    await seedToolCall({
      content: 'not this task',
      createdAt: new Date('2026-10-01T12:00:00Z'),
      id: 'tcit-unrelated-call',
      topicId: 'tcit-unrelated',
    });
    await seedToolCall({
      content: 'someone else',
      createdAt: new Date('2026-10-01T12:00:00Z'),
      id: 'tcit-foreign',
      ownerId: otherUserId,
      topicId: 'tcit-other',
    });

    const rows = await messageModel.listToolCallsInTopics({
      apiName: 'askUserQuestion',
      topicIds: ['tcit-round1', 'tcit-round2', 'tcit-other'],
    });

    expect(rows.map((row) => [row.topicId, row.content])).toEqual([
      ['tcit-round1', 'User answers:\n- q: yes'],
      ['tcit-round2', 'No answer received within the wait window'],
    ]);
    expect(JSON.parse(rows[0].arguments!)).toEqual({ questions: [{ question: 'tcit-a' }] });
  });

  it('keeps the newest calls when capped', async () => {
    for (const [i, id] of ['tcit-1', 'tcit-2', 'tcit-3'].entries()) {
      await seedToolCall({
        content: id,
        createdAt: new Date(Date.UTC(2026, 9, 1, 10 + i)),
        id,
        topicId: 'tcit-round1',
      });
    }

    const rows = await messageModel.listToolCallsInTopics({
      apiName: 'askUserQuestion',
      limit: 2,
      topicIds: ['tcit-round1'],
    });

    expect(rows.map((row) => row.content)).toEqual(['tcit-2', 'tcit-3']);
  });

  it('returns nothing for no topics', async () => {
    expect(
      await messageModel.listToolCallsInTopics({ apiName: 'askUserQuestion', topicIds: [] }),
    ).toEqual([]);
  });
});
