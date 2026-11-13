// @vitest-environment node
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { threads, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ThreadModel } from '../thread';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'thread-coverage-user';
const topicId = 'thread-coverage-topic';
const threadModel = new ThreadModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

afterEach(async () => {
  // Topics and threads cascade from their owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
});

const findThread = (id: string) => serverDB.query.threads.findFirst({ where: eq(threads.id, id) });

describe('ThreadModel coverage', () => {
  describe('attachRunOperation', () => {
    const insertThread = (id: string, status: ThreadStatus) =>
      serverDB.insert(threads).values({
        id,
        metadata: { completedAt: '2026-10-01T00:01:00.000Z', totalTokens: 15 },
        status,
        topicId,
        type: ThreadType.Isolation,
        userId,
      });

    it('records the operation id on a processing thread', async () => {
      await insertThread('thread-attach-live', ThreadStatus.Processing);

      await threadModel.attachRunOperation('thread-attach-live', { operationId: 'op-1' });

      expect((await findThread('thread-attach-live'))?.metadata).toEqual({ operationId: 'op-1' });
    });

    it('keeps the metadata of a run that already settled', async () => {
      await insertThread('thread-attach-settled', ThreadStatus.Completed);

      await threadModel.attachRunOperation('thread-attach-settled', { operationId: 'op-1' });

      expect((await findThread('thread-attach-settled'))?.metadata).toMatchObject({
        completedAt: '2026-10-01T00:01:00.000Z',
        totalTokens: 15,
      });
    });
  });

  describe('settleRun', () => {
    const insertThread = (id: string, status: ThreadStatus, operationId?: string) =>
      serverDB.insert(threads).values({
        id,
        metadata: { operationId, startedAt: '2026-10-01T00:00:00.000Z' },
        status,
        topicId,
        type: ThreadType.Isolation,
        userId,
      });
    const value = {
      metadata: {
        completedAt: '2026-10-01T00:01:00.000Z',
        operationId: 'op-1',
        startedAt: '2026-10-01T00:00:00.000Z',
      },
      status: ThreadStatus.Completed,
    };

    it('settles a processing thread owned by the run', async () => {
      await insertThread('thread-settle-own', ThreadStatus.Processing, 'op-1');

      expect(await threadModel.settleRun('thread-settle-own', 'op-1', value)).toBe(true);
      expect(await findThread('thread-settle-own')).toMatchObject(value);
    });

    it('settles a processing thread whose operation id is not written yet', async () => {
      await insertThread('thread-settle-early', ThreadStatus.Processing);

      expect(await threadModel.settleRun('thread-settle-early', 'op-1', value)).toBe(true);
    });

    it('leaves a thread claimed by a later run open', async () => {
      await insertThread('thread-settle-later', ThreadStatus.Processing, 'op-2');

      expect(await threadModel.settleRun('thread-settle-later', 'op-1', value)).toBe(false);
      expect((await findThread('thread-settle-later'))?.status).toBe(ThreadStatus.Processing);
    });

    it('refuses when a follow-up claimed the thread after the caller read it', async () => {
      await insertThread('thread-settle-claimed', ThreadStatus.Processing);

      const stale = { ...value, metadata: { ...value.metadata, startedAt: 'earlier-claim' } };
      expect(await threadModel.settleRun('thread-settle-claimed', 'op-1', stale)).toBe(false);
      expect((await findThread('thread-settle-claimed'))?.status).toBe(ThreadStatus.Processing);
    });

    it('does not overwrite a thread that is no longer processing', async () => {
      await insertThread('thread-settle-cancelled', ThreadStatus.Cancel, 'op-1');

      expect(await threadModel.settleRun('thread-settle-cancelled', 'op-1', value)).toBe(false);
      expect((await findThread('thread-settle-cancelled'))?.status).toBe(ThreadStatus.Cancel);
    });

    it('refuses to settle when the caller carries no claim timestamp', async () => {
      await insertThread('thread-settle-unstamped', ThreadStatus.Processing, 'op-1');

      const unsettled = {
        metadata: { completedAt: '2026-10-01T00:01:00.000Z', operationId: 'op-1' },
        status: ThreadStatus.Completed,
      } as unknown as typeof value;

      expect(await threadModel.settleRun('thread-settle-unstamped', 'op-1', unsettled)).toBe(false);
      expect((await findThread('thread-settle-unstamped'))?.status).toBe(ThreadStatus.Processing);
    });
  });

  describe('claimForRun', () => {
    it('claims a thread that has no status yet when no status is expected', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-coverage-fresh',
        status: null,
        topicId,
        type: ThreadType.Isolation,
        userId,
      });

      const claimed = await threadModel.claimForRun(
        'thread-coverage-fresh',
        {},
        { startedAt: '2026-10-01T00:00:00.000Z' },
      );

      expect(claimed).toBe(true);
      expect(await findThread('thread-coverage-fresh')).toMatchObject({
        metadata: { startedAt: '2026-10-01T00:00:00.000Z' },
        status: ThreadStatus.Processing,
      });
    });

    it('refuses a thread that already has a status when none is expected', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-coverage-failed',
        status: ThreadStatus.Failed,
        topicId,
        type: ThreadType.Isolation,
        userId,
      });

      const claimed = await threadModel.claimForRun(
        'thread-coverage-failed',
        {},
        { startedAt: '2026-10-01T00:00:00.000Z' },
      );

      expect(claimed).toBe(false);
      expect((await findThread('thread-coverage-failed'))?.status).toBe(ThreadStatus.Failed);
    });
  });
});
