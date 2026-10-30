// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messagePlugins, messages, messageTTS, topics, users } from '../../../schemas';
import type { LobeChatDatabase, Transaction } from '../../../type';
import { MessageModel } from '../../message';
import { materializeChatAudioItem } from '../../message/attachments';
import { MessageBranchSnapshots } from '../../message/branchSnapshots';
import { resolveCursorPageWindow } from '../../message/cursorWindow';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-coverage-group-a';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('MessageModel coverage — group A', () => {
  describe('analytics.topicMessageStats percentile edges', () => {
    it('returns the single count for every percentile when only one topic matches', async () => {
      await serverDB.insert(topics).values({ id: 'ga-one', userId });
      await serverDB.insert(messages).values([
        { content: 'a', id: 'ga-one-1', role: 'user', topicId: 'ga-one', userId },
        { content: 'b', id: 'ga-one-2', role: 'user', topicId: 'ga-one', userId },
      ]);

      const stats = await messageModel.topicMessageStats();

      expect(stats.topics).toBe(1);
      expect(stats.median).toBe(2);
      expect(stats.p90).toBe(2);
      expect(stats.p99).toBe(2);
    });

    it('hits an exact rank for the median of an odd number of topics', async () => {
      await serverDB.insert(topics).values([
        { id: 'ga-t1', userId },
        { id: 'ga-t2', userId },
        { id: 'ga-t3', userId },
      ]);
      await serverDB.insert(messages).values([
        { content: 'x', id: 'ga-t1-1', role: 'user', topicId: 'ga-t1', userId },
        { content: 'x', id: 'ga-t2-1', role: 'user', topicId: 'ga-t2', userId },
        { content: 'x', id: 'ga-t2-2', role: 'user', topicId: 'ga-t2', userId },
        { content: 'x', id: 'ga-t3-1', role: 'user', topicId: 'ga-t3', userId },
        { content: 'x', id: 'ga-t3-2', role: 'user', topicId: 'ga-t3', userId },
        { content: 'x', id: 'ga-t3-3', role: 'user', topicId: 'ga-t3', userId },
      ]);

      const stats = await messageModel.topicMessageStats();

      // sorted [1,2,3]: rank 0.5 * 2 = 1 lands exactly on the middle element
      expect(stats.median).toBe(2);
      expect(stats.p90).toBeCloseTo(2.8);
    });
  });

  describe('analytics.countApproximate planner fallbacks', () => {
    const seed = (n: number) =>
      serverDB.insert(messages).values(
        Array.from({ length: n }, (_, i) => ({
          content: `m${i}`,
          id: `ga-approx-${i}`,
          role: 'user' as const,
          userId,
        })),
      );

    it('parses a string plan and returns the rounded estimate when clearly past the cap', async () => {
      vi.spyOn(serverDB, 'transaction').mockResolvedValueOnce({
        rows: [{ 'QUERY PLAN': JSON.stringify([{ Plan: { 'Plan Rows': 123_456 } }]) }],
      } as any);

      const result = await messageModel.countApproximate(undefined, { cap: 10 });

      expect(result).toBe(123_000);
    });

    it('ignores a non-numeric plan estimate and uses the exact count', async () => {
      await seed(3);
      vi.spyOn(serverDB, 'transaction').mockResolvedValueOnce({ rows: [] } as any);

      const result = await messageModel.countApproximate(undefined, { cap: 10 });

      expect(result).toBe(3);
    });

    it('logs and falls back to the capped count when the planner estimate fails', async () => {
      await seed(8);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(serverDB, 'transaction').mockRejectedValueOnce(new Error('explain failed'));

      const result = await messageModel.countApproximate(undefined, { cap: 5 });

      // no estimate: the capped scan's cap + 1 is the floor
      expect(result).toBe(6);
      expect(errorSpy).toHaveBeenCalledWith(
        'countApproximate: planner estimate failed, using capped count only:',
        expect.any(Error),
      );
    });
  });

  describe('annotation.updateTTS', () => {
    it('is a no-op for an empty legacy payload', async () => {
      await serverDB.insert(messages).values({ content: 'x', id: 'ga-tts', role: 'user', userId });

      const result = await messageModel.updateTTS('ga-tts', {});

      expect(result).toBeUndefined();
      const rows = await serverDB.select().from(messageTTS).where(eq(messageTTS.id, 'ga-tts'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('attachments.materializeChatAudioItem', () => {
    const base = { id: 'aud', messageId: 'm', name: 'clip', size: 1, url: 'https://a/clip' };

    it('prefers codec and mimeType from the metadata', () => {
      expect(
        materializeChatAudioItem({
          ...base,
          fileType: 'audio/ogg',
          metadata: { codec: 'opus', durationMs: 1500, mimeType: 'audio/webm' },
        }),
      ).toEqual({
        alt: 'clip',
        codec: 'opus',
        durationMs: 1500,
        id: 'aud',
        mimeType: 'audio/webm',
        url: 'https://a/clip',
      });
    });

    it('falls back to the file type when metadata carries no mimeType', () => {
      expect(materializeChatAudioItem({ ...base, fileType: 'audio/mpeg', metadata: null })).toEqual(
        { alt: 'clip', id: 'aud', mimeType: 'audio/mpeg', url: 'https://a/clip' },
      );
    });

    it('omits mimeType when neither metadata nor file type provide one', () => {
      expect(materializeChatAudioItem({ ...base, fileType: null, metadata: {} })).toEqual({
        alt: 'clip',
        id: 'aud',
        url: 'https://a/clip',
      });
    });
  });

  describe('backgroundSubAgent guards', () => {
    it('claims nothing and releases nothing for an empty id list', async () => {
      await serverDB.insert(topics).values({ id: 'ga-bg-topic', userId });
      await serverDB
        .insert(messages)
        .values({ content: '', id: 'ga-bg', role: 'tool', topicId: 'ga-bg-topic', userId });
      await serverDB.insert(messagePlugins).values({
        apiName: 'callSubAgent',
        id: 'ga-bg',
        identifier: 'lobe-agent',
        state: { background: true, deliveredAt: 'before', status: 'completed' },
        toolCallId: 'tc-ga-bg',
        userId,
      });

      expect(await messageModel.claimBackgroundSubAgentDelivery([], 'now')).toEqual([]);
      await messageModel.releaseBackgroundSubAgentDelivery([]);

      const [row] = await serverDB
        .select({ state: messagePlugins.state })
        .from(messagePlugins)
        .where(eq(messagePlugins.id, 'ga-bg'));
      expect((row.state as any).deliveredAt).toBe('before');
    });
  });

  describe('branchSnapshots', () => {
    const snapshots = new MessageBranchSnapshots(serverDB, userId);
    const tx = serverDB as unknown as Transaction;

    it('captures an optimistic snapshot for a parent with no branches yet', async () => {
      await serverDB.insert(messages).values({
        content: 'p',
        id: 'ga-lonely',
        metadata: { activeBranchIndex: 0 },
        role: 'user',
        userId,
      });

      const result = await snapshots.captureActiveBranchSnapshots(tx, ['ga-lonely']);

      expect(result).toEqual([
        {
          activeBranchId: undefined,
          activeBranchIndex: 0,
          metadata: { activeBranchIndex: 0 },
          parentId: 'ga-lonely',
          wasOptimistic: true,
        },
      ]);
    });

    it('drops the active index once every branch of the parent is gone', async () => {
      await serverDB.insert(messages).values({
        content: 'p',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        id: 'ga-parent',
        metadata: { activeBranchIndex: 1, keep: true },
        role: 'user',
        userId,
      });
      await serverDB.insert(messages).values([
        {
          content: 'c1',
          createdAt: new Date('2026-01-01T00:00:01Z'),
          id: 'ga-c1',
          parentId: 'ga-parent',
          role: 'assistant',
          userId,
        },
        {
          content: 'c2',
          createdAt: new Date('2026-01-01T00:00:02Z'),
          id: 'ga-c2',
          parentId: 'ga-parent',
          role: 'assistant',
          userId,
        },
      ]);

      const captured = await snapshots.captureActiveBranchSnapshots(tx, ['ga-parent']);
      expect(captured[0].activeBranchId).toBe('ga-c2');

      await serverDB.delete(messages).where(eq(messages.parentId, 'ga-parent'));
      await snapshots.reconcileActiveBranchSnapshots(tx, captured);

      const [parent] = await serverDB
        .select({ metadata: messages.metadata })
        .from(messages)
        .where(eq(messages.id, 'ga-parent'));
      expect(parent.metadata).toEqual({ keep: true });
    });
  });

  describe('cursorWindow backward page without a user turn', () => {
    it('falls back to the oldest fetched row as the lower bound', async () => {
      await serverDB.insert(topics).values({ id: 'ga-cw', userId });
      await serverDB.insert(messages).values([
        {
          content: 'a1',
          createdAt: new Date('2026-02-01T00:00:00Z'),
          id: 'ga-cw-a1',
          role: 'assistant',
          topicId: 'ga-cw',
          userId,
        },
        {
          content: 'a2',
          createdAt: new Date('2026-02-01T00:00:01Z'),
          id: 'ga-cw-a2',
          role: 'assistant',
          topicId: 'ga-cw',
          userId,
        },
      ]);

      const window = await resolveCursorPageWindow(serverDB, {
        countBudget: 50,
        direction: 'backward',
        mainlineWhere: eq(messages.topicId, 'ga-cw'),
        roundLimit: 2,
        scopeWhere: eq(messages.userId, userId),
      });

      expect(window.hasMore).toBe(false);
      expect(window.nextCursor).toBeNull();

      const rows = await serverDB
        .select({ id: messages.id })
        .from(messages)
        .where(window.where)
        .orderBy(messages.createdAt);
      expect(rows.map((r) => r.id)).toEqual(['ga-cw-a1', 'ga-cw-a2']);
    });
  });
});
