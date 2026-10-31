import { MessageGroupType } from '@lobechat/types';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { chatGroups, messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { seedCursorRounds } from './cursorQueryTestUtils';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'cursor-forward-test';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.transaction(async (trx) => {
    await trx.delete(users).where(eq(users.id, userId));
    await trx.insert(users).values([{ id: userId }]);
  });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const walkForward = async (
  params: { countBudget?: number; groupId?: string; roundLimit: number; topicId: string },
  maxPages = 20,
) => {
  const pages: string[][] = [];
  let cursor: any = null;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await messageModel.queryTopicMessagesByCursor({
      ...params,
      cursor,
      direction: 'forward',
    });
    pages.push(page.messages.map((m) => m.id));
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      break;
    }
    cursor = page.nextCursor;
  }
  return pages;
};

describe('MessageModel.queryTopicMessagesByCursor forward', () => {
  it('starts at the first round and ends before the next round start', async () => {
    const topicId = 't-fwd-first';
    const { ids } = await seedCursorRounds(serverDB, userId, topicId, 5, 2);

    const page = await messageModel.queryTopicMessagesByCursor({
      direction: 'forward',
      roundLimit: 2,
      topicId,
    });

    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(0, 6));
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ createdAt: expect.any(String), id: `${topicId}-a2-2` });
  });

  it('walks every round once, in order, with no gaps', async () => {
    const topicId = 't-fwd-walk';
    const { ids } = await seedCursorRounds(serverDB, userId, topicId, 5, 2);

    const pages = await walkForward({ roundLimit: 2, topicId });

    expect(pages).toHaveLength(3);
    expect(pages.flat()).toEqual(ids);
    for (const page of pages) expect(page[0]).toMatch(/-u\d+$/);
  });

  it('ends at the last round boundary once the row budget is walked', async () => {
    const topicId = 't-fwd-budget';
    const { ids } = await seedCursorRounds(serverDB, userId, topicId, 4, 2);

    const page = await messageModel.queryTopicMessagesByCursor({
      countBudget: 5,
      direction: 'forward',
      roundLimit: 10,
      topicId,
    });

    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(0, 3));
    expect(page.hasMore).toBe(true);
  });

  it('splits a first round larger than the budget and continues it on the next page', async () => {
    const topicId = 't-fwd-oversized';
    const { ids } = await seedCursorRounds(serverDB, userId, topicId, 2, 9);

    const pages = await walkForward({ countBudget: 4, roundLimit: 1, topicId });

    expect(pages[0]).toEqual(ids.slice(0, 4));
    expect(pages.flat()).toEqual(ids);
  });

  it('returns an empty page with no cursor for an empty topic', async () => {
    const topicId = 't-fwd-empty';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);

    const page = await messageModel.queryTopicMessagesByCursor({
      direction: 'forward',
      topicId,
    });

    expect(page).toEqual({ hasMore: false, messages: [], nextCursor: null });
  });

  it('keeps microsecond boundaries exact across forward pages', async () => {
    const topicId = 't-fwd-micros';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);
    const roles = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'];
    const ids: string[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 6; i += 1) {
      const id = `${topicId}-m${i + 1}`;
      await serverDB.insert(messages).values({
        content: `c${i + 1}`,
        createdAt: sql`${`2023-01-01T00:00:00.${String(i + 1).padStart(6, '0')}Z`}::timestamptz`,
        id,
        parentId: prev,
        role: roles[i] as any,
        topicId,
        userId,
      });
      ids.push(id);
      prev = id;
    }

    const pages = await walkForward({ roundLimit: 1, topicId });

    expect(pages).toHaveLength(3);
    expect(pages.flat()).toEqual(ids);
  });

  it('emits every compression group exactly once over a full forward walk', async () => {
    const topicId = 't-fwd-groups';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);
    const row = (id: string, role: string, at: string, parentId?: string) => ({
      content: id,
      createdAt: new Date(at),
      id: `${topicId}-${id}`,
      parentId: parentId ? `${topicId}-${parentId}` : undefined,
      role: role as any,
      topicId,
      userId,
    });
    await serverDB
      .insert(messages)
      .values([
        row('u1', 'user', '2024-01-01T10:00:00Z'),
        row('a1', 'assistant', '2024-01-01T10:00:01Z', 'u1'),
        row('mid1', 'user', '2024-01-01T10:02:00Z', 'a1'),
        row('mid2', 'assistant', '2024-01-01T10:02:01Z', 'mid1'),
        row('u2', 'user', '2024-01-01T10:05:00Z', 'mid2'),
        row('a2', 'assistant', '2024-01-01T10:05:01Z', 'u2'),
        row('u3', 'user', '2024-01-01T10:06:00Z', 'a2'),
        row('a3', 'assistant', '2024-01-01T10:06:01Z', 'u3'),
      ]);
    await serverDB.insert(messageGroups).values({
      content: 'summary between round 1 and round 2',
      createdAt: new Date('2024-01-01T10:03:00Z'),
      id: `${topicId}-cg`,
      topicId,
      type: MessageGroupType.Compression,
      userId,
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: `${topicId}-cg` })
      .where(inArray(messages.id, [`${topicId}-mid1`, `${topicId}-mid2`]));

    const pages = await walkForward({ roundLimit: 1, topicId });

    const groupHits = pages.flat().filter((id) => id === `${topicId}-cg`);
    expect(groupHits).toHaveLength(1);
    expect(pages.flat().filter((id) => id !== `${topicId}-cg`)).toEqual(
      ['u1', 'a1', 'u2', 'a2', 'u3', 'a3'].map((id) => `${topicId}-${id}`),
    );
  });

  it('reads a group chat topic through its group id', async () => {
    const topicId = 't-fwd-group-chat';
    await serverDB.insert(chatGroups).values([{ id: 'cg-fwd', userId }]);
    await serverDB.insert(topics).values([{ groupId: 'cg-fwd', id: topicId, userId }]);
    await serverDB.insert(messages).values([
      {
        content: 'q1',
        createdAt: new Date(2023, 0, 1, 0, 0),
        groupId: 'cg-fwd',
        id: `${topicId}-u1`,
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'a1',
        createdAt: new Date(2023, 0, 1, 0, 1),
        groupId: 'cg-fwd',
        id: `${topicId}-a1`,
        parentId: `${topicId}-u1`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    const pages = await walkForward({ groupId: 'cg-fwd', roundLimit: 1, topicId });

    expect(pages).toEqual([[`${topicId}-u1`, `${topicId}-a1`]]);
  });
});
