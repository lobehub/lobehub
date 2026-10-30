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
