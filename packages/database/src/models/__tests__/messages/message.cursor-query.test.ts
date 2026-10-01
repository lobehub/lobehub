// Regression + behavior tests for MessageModel.queryTopicMessagesByCursor
// (round-boundary cursor pagination — stage 2 server layer).
import { MessageGroupType } from '@lobechat/types';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, chatGroups, messageGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'cursor-query-test';
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

/**
 * Seed `rounds` rounds of (1 user + `stepsPerRound` assistant) as one contiguous
 * mainline parentId chain. Returns the ordered ids (oldest→newest) plus the
 * round-start user ids.
 */
const seedRounds = async (topicId: string, rounds: number, stepsPerRound: number) => {
  await serverDB.insert(topics).values([{ id: topicId, userId }]);
  const rows: any[] = [];
  const ids: string[] = [];
  const roundStarts: string[] = [];
  let seq = 0;
  let prevId: string | null = null;
  for (let r = 1; r <= rounds; r += 1) {
    const uid = `${topicId}-u${r}`;
    rows.push({
      id: uid,
      userId,
      topicId,
      role: 'user',
      parentId: prevId,
      content: `q${r}`,
      createdAt: new Date(2023, 0, 1, 0, seq),
    });
    seq += 1;
    ids.push(uid);
    roundStarts.push(uid);
    prevId = uid;
    for (let step = 1; step <= stepsPerRound; step += 1) {
      const sid = `${topicId}-a${r}-${step}`;
      rows.push({
        id: sid,
        userId,
        topicId,
        role: 'assistant',
        parentId: prevId,
        content: `a${r}.${step}`,
        createdAt: new Date(2023, 0, 1, 0, seq),
      });
      seq += 1;
      ids.push(sid);
      prevId = sid;
    }
  }
  await serverDB.insert(messages).values(rows);
  return { ids, lastId: prevId as string, roundStarts };
};

describe('MessageModel.queryTopicMessagesByCursor', () => {
  it('initial load returns the newest N rounds, round-aligned, with the final answer', async () => {
    const topicId = 't-cursor-initial';
    const { lastId } = await seedRounds(topicId, 5, 2); // 5 rounds x 3 = 15 msgs

    const page = await messageModel.queryTopicMessagesByCursor({ topicId, roundLimit: 2 });

    // Newest 2 rounds = round 4 (u4..a4-2) + round 5 (u5..a5-2) = 6 messages, asc.
    expect(page.messages).toHaveLength(6);
    expect(page.messages[0].id).toBe(`${topicId}-u4`); // round-aligned lower bound
    expect(page.messages[0].role).toBe('user');
    expect(page.messages.at(-1)!.id).toBe(lastId); // final answer present
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ createdAt: expect.any(String), id: `${topicId}-u4` });
  });

  it('walks older pages via nextCursor with no gaps and no splitting a round', async () => {
    const topicId = 't-cursor-walk';
    const { ids } = await seedRounds(topicId, 5, 2); // 15 msgs

    const collected: string[][] = [];
    let cursor: any = null;
    // Page backwards until exhausted.
    for (let i = 0; i < 10; i += 1) {
      const page = await messageModel.queryTopicMessagesByCursor({
        topicId,
        roundLimit: 2,
        cursor,
      });
      collected.push(page.messages.map((m) => m.id));
      if (!page.hasMore) {
        expect(page.nextCursor).toBeNull();
        break;
      }
      cursor = page.nextCursor;
    }

    // 5 rounds / 2 per page => pages of [round4,5], [round2,3], [round1].
    expect(collected).toHaveLength(3);
    expect(collected[2]).toHaveLength(3); // last page = round 1 only

    // Every page starts on a user message (never mid-round).
    for (const pageIds of collected) {
      expect(pageIds[0]).toMatch(/-u\d+$/);
    }

    // `collected` is newest-page-first and each page is already ascending, so
    // reversing the page order then flattening rebuilds the full transcript
    // oldest→newest. It must equal every seeded id exactly — nothing dropped in a
    // boundary gap, nothing duplicated. This is the property PR1's offset paging
    // could not hold.
    const rebuilt = [...collected].reverse().flat();
    expect(rebuilt).toEqual(ids);
    expect(new Set(rebuilt).size).toBe(ids.length);
  });

  it('returns the whole topic when it has fewer rounds than the limit', async () => {
    const topicId = 't-cursor-short';
    const { ids } = await seedRounds(topicId, 2, 2); // 6 msgs, 2 rounds

    const page = await messageModel.queryTopicMessagesByCursor({ topicId, roundLimit: 5 });

    expect(page.messages.map((m) => m.id)).toEqual(ids);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('caps the window by countBudget even when roundLimit is larger', async () => {
    const topicId = 't-cursor-budget';
    await seedRounds(topicId, 5, 0); // 5 single-message (user-only) rounds

    // Budget 3 forces at most ~3 rows despite roundLimit 10.
    const page = await messageModel.queryTopicMessagesByCursor({
      topicId,
      roundLimit: 10,
      countBudget: 3,
    });

    expect(page.messages).toHaveLength(3);
    expect(page.messages.at(-1)!.id).toBe(`${topicId}-u5`); // newest kept
    expect(page.messages[0].id).toBe(`${topicId}-u3`); // budget-capped lower bound
    expect(page.hasMore).toBe(true);
  });

  it('returns an empty page with no cursor for an empty topic', async () => {
    const topicId = 't-cursor-empty';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);

    const page = await messageModel.queryTopicMessagesByCursor({ topicId });

    expect(page.messages).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  // `messages.createdAt` is a timestamptz whose now() default can
  // carry microseconds. A cursor round-tripped through a millisecond JS Date would
  // round sub-millisecond boundaries and drop/duplicate rows across pages. Seed
  // rows that all share ONE millisecond but differ by microseconds and prove the
  // backward walk still reconstructs the transcript exactly.
  it('preserves microsecond precision across cursor pages (no leak within a millisecond)', async () => {
    const topicId = 't-cursor-micros';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);

    // 3 rounds x (user, assistant) = 6 messages, all within 2023-01-01T00:00:00.000
    // but 1..6 microseconds apart, ascending in time.
    const roles = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'];
    let prev: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = `${topicId}-m${i + 1}`;
      const micros = String(i + 1).padStart(6, '0');
      await serverDB.insert(messages).values({
        content: `c${i + 1}`,
        createdAt: sql`${`2023-01-01T00:00:00.${micros}Z`}::timestamptz`,
        id,
        parentId: prev,
        role: roles[i] as any,
        topicId,
        userId,
      });
      ids.push(id);
      prev = id;
    }

    const collected: string[][] = [];
    let cursor: any = null;
    for (let i = 0; i < 10; i += 1) {
      const page = await messageModel.queryTopicMessagesByCursor({
        topicId,
        roundLimit: 1,
        cursor,
      });
      collected.push(page.messages.map((m) => m.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    // 3 rounds / 1 per page = 3 pages, and reversing the page order rebuilds all
    // six ids with none dropped in a sub-millisecond boundary gap and none doubled.
    expect(collected).toHaveLength(3);
    const rebuilt = [...collected].reverse().flat();
    expect(rebuilt).toEqual(ids);
    expect(new Set(rebuilt).size).toBe(ids.length);
  });

  // the cursor path must constrain MessageGroup assembly to the
  // page's time window. Otherwise every page eagerly loads (and repeats) the whole
  // topic's compression groups — exactly the compressed history cursor pagination
  // exists to defer.
  it('windows out compression groups that fall outside the page range', async () => {
    const topicId = 't-cursor-groups';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);

    // Old compressed history (early), then two newer uncompressed mainline rounds.
    await serverDB.insert(messages).values([
      {
        id: `${topicId}-old1`,
        userId,
        topicId,
        role: 'user',
        content: 'old1',
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: `${topicId}-old2`,
        userId,
        topicId,
        role: 'assistant',
        content: 'old2',
        createdAt: new Date('2024-01-01T10:00:01Z'),
      },
      {
        id: `${topicId}-u1`,
        userId,
        topicId,
        role: 'user',
        content: 'q1',
        parentId: `${topicId}-old2`,
        createdAt: new Date('2024-01-01T10:05:00Z'),
      },
      {
        id: `${topicId}-a1`,
        userId,
        topicId,
        role: 'assistant',
        content: 'a1',
        parentId: `${topicId}-u1`,
        createdAt: new Date('2024-01-01T10:05:01Z'),
      },
      {
        id: `${topicId}-u2`,
        userId,
        topicId,
        role: 'user',
        content: 'q2',
        parentId: `${topicId}-a1`,
        createdAt: new Date('2024-01-01T10:06:00Z'),
      },
      {
        id: `${topicId}-a2`,
        userId,
        topicId,
        role: 'assistant',
        content: 'a2',
        parentId: `${topicId}-u2`,
        createdAt: new Date('2024-01-01T10:06:01Z'),
      },
    ]);

    // A compression group covering the old messages, dated in the old range.
    await serverDB.insert(messageGroups).values({
      id: `${topicId}-cg`,
      content: 'summary of early conversation',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T10:00:30Z'),
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: `${topicId}-cg` })
      .where(inArray(messages.id, [`${topicId}-old1`, `${topicId}-old2`]));

    // Newest cursor page (round 2 only) is windowed to [10:06:00, now]; the group
    // at 10:00:30 is outside it and must not be pulled in.
    const page = await messageModel.queryTopicMessagesByCursor({ topicId, roundLimit: 1 });
    expect(page.messages.some((m) => m.role === 'compressedGroup')).toBe(false);
    expect(page.messages.map((m) => m.id)).toEqual([`${topicId}-u2`, `${topicId}-a2`]);

    // The group still exists and the full (client-mode) query surfaces it — proving
    // the cursor page omitted it by windowing, not because it was absent.
    const full = await messageModel.query({ topicId });
    expect(full.some((m) => m.role === 'compressedGroup' && m.id === `${topicId}-cg`)).toBe(true);

    // ...and the cursor walk must still reach it: the oldest page leaves the group
    // window's lower side open, so the group dated before the first remaining
    // mainline row is emitted exactly once rather than never.
    const older = await messageModel.queryTopicMessagesByCursor({
      topicId,
      roundLimit: 1,
      cursor: page.nextCursor,
    });
    expect(older.hasMore).toBe(false);
    expect(older.messages.map((m) => m.id)).toEqual([
      `${topicId}-cg`,
      `${topicId}-u1`,
      `${topicId}-a1`,
    ]);
  });

  // compression can move EVERY message of a topic into a group,
  // leaving no mainline rows. The cursor path must still surface the synthetic
  // `compressedGroup` node (as `query` does) instead of an empty transcript.
  it('returns the compressed group for a topic whose whole history is compressed', async () => {
    const topicId = 't-cursor-compressed-only';
    await serverDB.insert(topics).values([{ id: topicId, userId }]);
    await serverDB.insert(messageGroups).values({
      id: `${topicId}-cg`,
      content: 'summary of everything',
      type: MessageGroupType.Compression,
      topicId,
      userId,
      createdAt: new Date('2024-01-01T11:00:00Z'),
    });
    await serverDB.insert(messages).values([
      {
        id: `${topicId}-u1`,
        userId,
        topicId,
        role: 'user',
        content: 'q1',
        messageGroupId: `${topicId}-cg`,
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: `${topicId}-a1`,
        userId,
        topicId,
        role: 'assistant',
        content: 'a1',
        messageGroupId: `${topicId}-cg`,
        createdAt: new Date('2024-01-01T10:00:01Z'),
      },
    ]);

    const page = await messageModel.queryTopicMessagesByCursor({ topicId });

    expect(page.messages.map((m) => ({ id: m.id, role: m.role }))).toEqual([
      { id: `${topicId}-cg`, role: 'compressedGroup' },
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  // a concrete topic is the conversation boundary. A caller passing
  // its own agentId must still see rows written by another agent in the same topic
  // (e.g. `callAgent` / delegated replies), matching `query`.
  it('keeps rows from other agents in the same topic when agentId is given', async () => {
    const topicId = 't-cursor-mixed-agent';
    await serverDB.insert(agents).values([
      { id: 'cursor-agent-main', userId, title: 'Main' },
      { id: 'cursor-agent-sub', userId, title: 'Sub' },
    ]);
    await serverDB.insert(topics).values([{ id: topicId, userId }]);
    await serverDB.insert(messages).values([
      {
        id: `${topicId}-u1`,
        userId,
        topicId,
        agentId: 'cursor-agent-main',
        role: 'user',
        content: 'q1',
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: `${topicId}-a1`,
        userId,
        topicId,
        agentId: 'cursor-agent-sub',
        role: 'assistant',
        content: 'delegated reply',
        parentId: `${topicId}-u1`,
        createdAt: new Date('2024-01-01T10:00:01Z'),
      },
      {
        id: `${topicId}-a2`,
        userId,
        topicId,
        agentId: 'cursor-agent-main',
        role: 'assistant',
        content: 'final',
        parentId: `${topicId}-a1`,
        createdAt: new Date('2024-01-01T10:00:02Z'),
      },
    ]);

    const page = await messageModel.queryTopicMessagesByCursor({
      agentId: 'cursor-agent-main',
      topicId,
    });

    expect(page.messages.map((m) => m.id)).toEqual([
      `${topicId}-u1`,
      `${topicId}-a1`,
      `${topicId}-a2`,
    ]);
  });
  it('reads a group chat topic through its group id, like `query`', async () => {
    const topicId = 't-cursor-group';
    await serverDB.insert(chatGroups).values([{ id: 'cg-cursor', userId }]);
    await serverDB.insert(topics).values([{ groupId: 'cg-cursor', id: topicId, userId }]);
    await serverDB.insert(messages).values([
      {
        content: 'q1',
        createdAt: new Date(2023, 0, 1, 0, 0),
        groupId: 'cg-cursor',
        id: `${topicId}-u1`,
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'a1',
        createdAt: new Date(2023, 0, 1, 0, 1),
        groupId: 'cg-cursor',
        id: `${topicId}-a1`,
        parentId: `${topicId}-u1`,
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    const page = await messageModel.queryTopicMessagesByCursor({ groupId: 'cg-cursor', topicId });

    expect(page.messages.map((m) => m.id)).toEqual([`${topicId}-u1`, `${topicId}-a1`]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('fails closed on an agent-share visitor topic, like `query`', async () => {
    const topicId = 't-cursor-visitor';
    await seedRounds(topicId, 2, 1);
    await serverDB.update(topics).set({ senderId: 'visitor-1' }).where(eq(topics.id, topicId));

    const page = await messageModel.queryTopicMessagesByCursor({ topicId });

    expect(page).toEqual({ hasMore: false, messages: [], nextCursor: null });
  });
});
