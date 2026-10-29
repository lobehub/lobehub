// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TopicModel } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-find-guards-user';
const agentId = 'topic-find-guards-agent';
const topicId = 'topic-find-guards-topic';
const updatedAt = new Date('2026-08-01T12:34:56.789Z');

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, slug: 'inbox', userId });
  await serverDB
    .insert(topics)
    .values({ agentId, id: topicId, title: 'Guarded', updatedAt, userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Agents and topics cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('queryRecent updatedAt guard', () => {
  it('turns a non-Date activity time from the decoder back into a Date', async () => {
    // `mapWith(topics.updatedAt)` decodes through the column; here it hands back the ISO
    // string, as a driver or drizzle upgrade that stops parsing timestamptz would.
    const decode = vi
      .spyOn(topics.updatedAt, 'mapFromDriverValue')
      .mockImplementation((value) =>
        value instanceof Date ? (value.toISOString() as unknown as Date) : new Date(value),
      );

    const [item] = await new TopicModel(serverDB, userId).queryRecent();

    expect(decode).toHaveBeenCalled();
    expect(item).toMatchObject({ id: topicId, title: 'Guarded', type: 'agent' });
    expect(item.updatedAt).toBeInstanceOf(Date);
    expect(item.updatedAt.getTime()).toBe(updatedAt.getTime());
  });
});
