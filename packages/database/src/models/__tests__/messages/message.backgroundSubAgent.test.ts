// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'background-sub-agent-user';
const otherUserId = 'background-sub-agent-other';
const messageModel = new MessageModel(serverDB, userId);

const identifier = 'lobe-agent';
const apiName = 'callSubAgent';
const query = { topicId: 'bsa-topic' };

const seedCall = async (opts: {
  apiName?: string;
  createdAt?: Date;
  id: string;
  ownerId?: string;
  state: Record<string, unknown> | null;
  topicId?: string;
}) => {
  const owner = opts.ownerId ?? userId;
  await serverDB.insert(messages).values({
    content: '',
    createdAt: opts.createdAt ?? new Date('2026-10-01T00:00:00Z'),
    id: opts.id,
    role: 'tool',
    topicId: opts.topicId ?? 'bsa-topic',
    userId: owner,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: opts.apiName ?? apiName,
    id: opts.id,
    identifier,
    state: opts.state,
    toolCallId: `tc-${opts.id}`,
    userId: owner,
  });
};

const readState = async (id: string) => {
  const [row] = await serverDB
    .select({ state: messagePlugins.state })
    .from(messagePlugins)
    .where(eq(messagePlugins.id, id));
  return row?.state as Record<string, unknown> | null;
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: 'bsa-topic', userId },
    { id: 'bsa-topic2', userId },
    { id: 'bsa-other-topic', userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel background sub-agent calls', () => {
  describe('listBackgroundSubAgentCalls', () => {
    it('lists only still-running background calls for the running scope', async () => {
      await seedCall({ id: 'running', state: { background: true, status: 'pending' } });
      await seedCall({ id: 'done', state: { background: true, status: 'completed' } });
      await seedCall({ id: 'foreground', state: { status: 'pending' } });
      await seedCall({ id: 'no-state', state: null });

      const rows = await messageModel.listBackgroundSubAgentCalls({ ...query, scope: 'running' });

      expect(rows.map((row) => row.id)).toEqual(['running']);
    });

    it('lists finished, undelivered background calls oldest first', async () => {
      await seedCall({
        createdAt: new Date('2026-10-01T00:00:02Z'),
        id: 'failed',
        state: { background: true, status: 'error', threadId: 'thd-2' },
      });
      await seedCall({
        createdAt: new Date('2026-10-01T00:00:01Z'),
        id: 'completed',
        state: { background: true, status: 'completed', threadId: 'thd-1' },
      });
      await seedCall({
        id: 'delivered',
        state: { background: true, deliveredAt: '2026-10-01T00:00:03Z', status: 'completed' },
      });
      await seedCall({ id: 'running', state: { background: true, status: 'pending' } });

      const rows = await messageModel.listBackgroundSubAgentCalls({
        ...query,
        scope: 'undelivered',
      });

      expect(rows.map((row) => row.id)).toEqual(['completed', 'failed']);
      expect(rows[0].state).toMatchObject({ status: 'completed', threadId: 'thd-1' });
    });

    it('covers every background call of the topic and owner, whichever tool made it', async () => {
      const state = { background: true, status: 'completed' };
      await seedCall({ createdAt: new Date('2026-10-01T00:00:01Z'), id: 'mine', state });
      await seedCall({
        apiName: 'callAgent',
        createdAt: new Date('2026-10-01T00:00:02Z'),
        id: 'call-agent',
        state,
      });
      await seedCall({ id: 'other-topic', state, topicId: 'bsa-topic2' });
      await seedCall({ id: 'other-user', ownerId: otherUserId, state, topicId: 'bsa-other-topic' });

      const rows = await messageModel.listBackgroundSubAgentCalls({
        ...query,
        scope: 'undelivered',
      });

      expect(rows.map((row) => row.id)).toEqual(['mine', 'call-agent']);
    });
  });

  describe('claimBackgroundSubAgentDelivery', () => {
    it('stamps deliveredAt once and keeps the rest of the state', async () => {
      await seedCall({ id: 'a', state: { background: true, status: 'completed', threadId: 't' } });

      const first = await messageModel.claimBackgroundSubAgentDelivery(['a'], 'when-1');
      const second = await messageModel.claimBackgroundSubAgentDelivery(['a'], 'when-2');

      expect(first).toEqual(['a']);
      expect(second).toEqual([]);
      expect(await readState('a')).toEqual({
        background: true,
        deliveredAt: 'when-1',
        status: 'completed',
        threadId: 't',
      });
    });

    it('cannot claim another user’s row', async () => {
      await seedCall({
        id: 'foreign',
        ownerId: otherUserId,
        state: { background: true, status: 'completed' },
        topicId: 'bsa-other-topic',
      });

      expect(await messageModel.claimBackgroundSubAgentDelivery(['foreign'], 'when')).toEqual([]);
      expect(await readState('foreign')).not.toHaveProperty('deliveredAt');
    });

    it('lets a released row be claimed again', async () => {
      await seedCall({ id: 'b', state: { background: true, status: 'completed' } });
      await messageModel.claimBackgroundSubAgentDelivery(['b'], 'when-1');

      await messageModel.releaseBackgroundSubAgentDelivery(['b']);

      expect(await readState('b')).toEqual({ background: true, status: 'completed' });
      expect(await messageModel.claimBackgroundSubAgentDelivery(['b'], 'when-2')).toEqual(['b']);
    });
  });
});
