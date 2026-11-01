// MessageModel.queryTopicMessagesByCursor when no round start exists at all:
// the oversized-round lookup finds no user message to extend to, so the page
// falls back to the oldest fetched row.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'cursor-no-round-start-test';
const messageModel = new MessageModel(serverDB, userId);

/** `count` chained mainline rows, oldest first, none of them a round start. */
const seedWithoutRoundStart = async (topicId: string, count: number, steerUser = false) => {
  await serverDB.insert(topics).values({ id: topicId, userId });
  const ids = Array.from({ length: count }, (_, i) => `${topicId}-m${i + 1}`);
  await serverDB.insert(messages).values(
    ids.map((id, i) => ({
      content: `m${i + 1}`,
      createdAt: new Date(2023, 0, 1, 0, i),
      id,
      // A steered user message continues a turn instead of starting one.
      metadata: steerUser && i === 0 ? { steer: true } : undefined,
      parentId: i === 0 ? null : ids[i - 1],
      role: steerUser && i === 0 ? 'user' : 'assistant',
      topicId,
      userId,
    })),
  );
  return ids;
};

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.insert(users).values([{ id: userId }]);
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel.queryTopicMessagesByCursor without a round start', () => {
  it('falls back to the oldest fetched row when the budget is exceeded', async () => {
    const topicId = 't-cursor-no-round-start';
    const ids = await seedWithoutRoundStart(topicId, 6);

    const page = await messageModel.queryTopicMessagesByCursor({
      countBudget: 3,
      roundLimit: 1000,
      topicId,
    });

    // countBudget + 1 rows are fetched; the oldest of them bounds the page.
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(2));
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ createdAt: expect.any(String), id: ids[2] });
  });

  it('does not treat a steered user message as a round start', async () => {
    const topicId = 't-cursor-no-round-start-steer';
    const ids = await seedWithoutRoundStart(topicId, 5, true);

    const page = await messageModel.queryTopicMessagesByCursor({
      countBudget: 2,
      roundLimit: 1000,
      topicId,
    });

    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(2));
    expect(page.hasMore).toBe(true);
  });
});
