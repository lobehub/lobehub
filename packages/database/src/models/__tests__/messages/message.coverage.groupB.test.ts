import { MessageGroupType } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import type { MessageGroupMemberRecord } from '../../message/groupNodes';
import { buildMessageGroupNode, planMessageGroupHydration } from '../../message/groupNodes';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'msg-cov-groupb-user';
const orphanUserId = 'msg-cov-groupb-orphan';
const messageModel = new MessageModel(serverDB, userId);

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

/**
 * A drizzle-shaped stand-in whose every builder call chains and whose await
 * resolves to `result`. Used only for rows the real schema cannot produce
 * (columns the WHERE clause already proves non-null / always-present aggregates).
 */
const fakeDb = (result: unknown) => {
  const chain: any = new Proxy(function () {}, {
    apply: () => chain,
    get: (_target, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return () => chain;
    },
  });
  return chain as LobeChatDatabase;
};

const cleanup = async () => {
  await serverDB.delete(messages).where(eq(messages.userId, orphanUserId));
  await serverDB.delete(users).where(eq(users.id, orphanUserId));
  await serverDB.delete(users).where(eq(users.id, userId));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
});

afterEach(cleanup);

describe('MessageModel coverage (group B)', () => {
  describe('queryLastUserMessageByTopics', () => {
    it('returns an empty map without querying for no topics', async () => {
      const result = await messageModel.queryLastUserMessageByTopics([]);
      expect(result.size).toBe(0);
    });

    it('keeps the newest non-blank user message per topic', async () => {
      await serverDB.insert(topics).values([
        { id: 'msg-cov-b-t1', userId },
        { id: 'msg-cov-b-t2', userId },
      ]);
      await serverDB.insert(messages).values([
        {
          content: 'older',
          createdAt: at(1),
          id: 'b-m1',
          role: 'user',
          topicId: 'msg-cov-b-t1',
          userId,
        },
        {
          content: '  newest  ',
          createdAt: at(2),
          id: 'b-m2',
          role: 'user',
          topicId: 'msg-cov-b-t1',
          userId,
        },
        {
          content: 'reply',
          createdAt: at(3),
          id: 'b-m3',
          role: 'assistant',
          topicId: 'msg-cov-b-t1',
          userId,
        },
        // whitespace-only content passes the SQL `<> ''` filter but trims to empty
        {
          content: '   ',
          createdAt: at(4),
          id: 'b-m4',
          role: 'user',
          topicId: 'msg-cov-b-t2',
          userId,
        },
      ]);

      const result = await messageModel.queryLastUserMessageByTopics([
        'msg-cov-b-t1',
        'msg-cov-b-t2',
      ]);

      expect(result).toEqual(new Map([['msg-cov-b-t1', 'newest']]));
    });
  });

  describe('queryTopicTranscript', () => {
    it('falls back to a zero total when the count query returns no row', async () => {
      const model = new MessageModel(fakeDb([]), userId);

      const result = await model.queryTopicTranscript({ limit: 10, offset: 0, topicId: 't' });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('query / queryWithWhere', () => {
    it('pages a topic by offset (current > 0) without the newest-page round trim', async () => {
      await serverDB.insert(topics).values({ id: 'msg-cov-b-page', userId });
      await serverDB.insert(messages).values([
        {
          content: 'q1',
          createdAt: at(1),
          id: 'b-p1',
          role: 'user',
          topicId: 'msg-cov-b-page',
          userId,
        },
        {
          content: 'a1',
          createdAt: at(2),
          id: 'b-p2',
          role: 'assistant',
          topicId: 'msg-cov-b-page',
          userId,
        },
        {
          content: 'q2',
          createdAt: at(3),
          id: 'b-p3',
          role: 'user',
          topicId: 'msg-cov-b-page',
          userId,
        },
        {
          content: 'a2',
          createdAt: at(4),
          id: 'b-p4',
          role: 'assistant',
          topicId: 'msg-cov-b-page',
          userId,
        },
      ]);

      // Newest-first page 1 of size 3 => only the oldest row remains.
      const result = await messageModel.query({
        current: 1,
        pageSize: 3,
        topicId: 'msg-cov-b-page',
      });

      expect(result.map((m) => m.id)).toEqual(['b-p1']);
    });

    it('collapses the sender to null when the sender user row is gone', async () => {
      await serverDB.insert(users).values({ id: orphanUserId });
      await serverDB.insert(messages).values({
        content: 'orphaned',
        createdAt: at(1),
        id: 'b-orphan',
        role: 'user',
        userId: orphanUserId,
      });
      // Remove the user without firing the ON DELETE CASCADE, leaving an
      // orphaned message row whose LEFT JOIN to `users` is null.
      await serverDB.transaction(async (trx) => {
        await trx.execute(sql`SET LOCAL session_replication_role = replica`);
        await trx.delete(users).where(eq(users.id, orphanUserId));
      });

      const result = await new MessageModel(serverDB, orphanUserId).query();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b-orphan');
      expect((result[0] as any).sender).toBeNull();
    });
  });

  describe('deleteMessagesBySession', () => {
    beforeEach(async () => {
      await serverDB.insert(sessions).values({ id: 'msg-cov-b-s1', userId });
      await serverDB.insert(topics).values({ id: 'msg-cov-b-dt', userId });
      await serverDB.insert(messages).values([
        {
          agentId: null,
          content: 'in topic',
          id: 'b-d1',
          role: 'user',
          topicId: 'msg-cov-b-dt',
          userId,
        },
        {
          agentId: null,
          content: 'session legacy',
          id: 'b-d2',
          role: 'user',
          sessionId: 'msg-cov-b-s1',
          userId,
        },
        { agentId: null, content: 'no session', id: 'b-d3', role: 'user', userId },
      ]);
    });

    const remaining = async () =>
      (await serverDB.select({ id: messages.id }).from(messages).where(eq(messages.userId, userId)))
        .map((r) => r.id)
        .sort();

    it('deletes every message of a concrete topic regardless of session/agent', async () => {
      await messageModel.deleteMessagesBySession('ignored-session', 'msg-cov-b-dt', null, {
        agentId: 'ignored-agent',
      });

      expect(await remaining()).toEqual(['b-d2', 'b-d3']);
    });

    it('matches agent-less rows of the given session when an agentId is passed', async () => {
      await messageModel.deleteMessagesBySession('msg-cov-b-s1', null, null, {
        agentId: 'msg-cov-b-agent',
      });

      expect(await remaining()).toEqual(['b-d1', 'b-d3']);
    });

    it('matches only the agent (and legacy inbox) when no session is passed', async () => {
      await messageModel.deleteMessagesBySession(null, null, null, { agentId: 'msg-cov-b-agent' });

      // No agent-owned row, no session match: nothing outside a topic matched by session.
      expect(await remaining()).toEqual(['b-d1', 'b-d2', 'b-d3']);
    });
  });

  describe('lookup', () => {
    it('findShareVisitorMessageIds short-circuits on no ids', async () => {
      expect(await messageModel.findShareVisitorMessageIds([])).toEqual([]);
    });
  });

  describe('groupNodes', () => {
    const record = (
      id: string,
      overrides: Partial<MessageGroupMemberRecord> = {},
    ): MessageGroupMemberRecord => ({
      carriesTodos: null,
      favorite: null,
      id,
      messageGroupId: 'g1',
      pluginApiName: null,
      pluginIdentifier: null,
      role: 'assistant',
      ...overrides,
    });

    const group = (type: string, id = 'g1') => ({
      content: 'summary',
      createdAt: at(0),
      id,
      metadata: null,
      topicId: 't',
      type,
      updatedAt: at(0),
    });

    it('planMessageGroupHydration ignores records without a group id', () => {
      const plan = planMessageGroupHydration(
        [{ id: 'g1', type: MessageGroupType.Parallel }],
        [record('loose', { messageGroupId: null }), record('m1')],
      );

      expect(plan.recordsByGroup.get('g1')!.map((r) => r.id)).toEqual(['m1']);
      expect(plan.idsToHydrate).toEqual(['m1']);
    });

    it('buildMessageGroupNode tolerates a group missing from the plan', () => {
      const plan = planMessageGroupHydration([], []);

      const compare = buildMessageGroupNode(
        group(MessageGroupType.Parallel, 'gx') as any,
        plan,
        new Map(),
      );
      expect(compare).toMatchObject({ children: [], id: 'gx', role: 'compareGroup' });

      const compressed = buildMessageGroupNode(
        group(MessageGroupType.Compression, 'gy') as any,
        plan,
        new Map(),
      );
      expect(compressed).toMatchObject({
        compressedMessages: [],
        id: 'gy',
        lastMessageId: undefined,
        pinnedMessages: [],
        role: 'compressedGroup',
      });
      expect(compressed).not.toHaveProperty('compressedOmittedIds');
    });

    it('counts every member as a turn when an omitted compression group has no user message', () => {
      const records = Array.from({ length: 301 }, (_, i) => record(`m${i}`));
      const plan = planMessageGroupHydration(
        [{ id: 'g1', type: MessageGroupType.Compression }],
        records,
      );

      const node = buildMessageGroupNode(
        group(MessageGroupType.Compression) as any,
        plan,
        new Map(),
      );

      expect((node as any).compressedOmittedIds).toEqual(['m0']);
      expect((node as any).compressedTurnCount).toBe(301);
    });
  });
});
