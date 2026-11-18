// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topics, users } from '@/database/schemas';

import { TopicArchiveService } from './index';

const scheduleWorktreeCleanup = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/worktreeCleanup', () => ({ scheduleWorktreeCleanup }));

const db = await getTestDB();
const userId = 'topic-archive-user';

const seed = async (id: string, status: 'active' | 'completed' | 'running') =>
  db.insert(topics).values({ id, status, title: id, userId });

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  scheduleWorktreeCleanup.mockReset();
  await db.delete(topics).where(eq(topics.userId, userId));
  await db.delete(users).where(inArray(users.id, [userId]));
});

describe('TopicArchiveService', () => {
  it('fires the archive follow-up for every topic a batch archives, with its previous status', async () => {
    await seed('a', 'active');
    await seed('b', 'running');
    await seed('c', 'completed');

    const archived = await new TopicArchiveService(db, userId).archiveTopics(['a', 'b', 'c']);

    expect(archived.map((row) => row.status)).toEqual(['completed', 'completed', 'completed']);
    // `c` was already archived: nothing new to set off.
    expect(scheduleWorktreeCleanup).toHaveBeenCalledTimes(2);
    expect(scheduleWorktreeCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: { a: 'active' },
        topicIds: ['a'],
        trigger: 'archived',
      }),
    );
    expect(scheduleWorktreeCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ previousStatus: { b: 'running' }, topicIds: ['b'] }),
    );
  });

  it('treats the legacy archived status as an archive too', async () => {
    await seed('legacy', 'active');
    await new TopicArchiveService(db, userId).updateTopic('legacy', { status: 'archived' });
    expect(scheduleWorktreeCleanup).toHaveBeenCalledTimes(1);
  });

  it('does nothing extra for other updates or a topic it cannot see', async () => {
    await seed('t', 'active');
    const service = new TopicArchiveService(db, userId);
    await service.updateTopic('t', { title: 'renamed' });
    await service.updateTopic('t', { status: 'unread' });
    await service.archiveTopics(['missing']);
    await new TopicArchiveService(db, 'someone-else').archiveTopics(['t']);
    expect(scheduleWorktreeCleanup).not.toHaveBeenCalled();
  });
});
