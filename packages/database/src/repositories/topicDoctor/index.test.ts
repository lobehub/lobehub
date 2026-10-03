// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages } from '../../schemas/message';
import { topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { TopicDoctorRepo } from './index';

const userId = 'topic-doctor-test-user';
const topicId = 'topic-doctor-test-topic';

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
});

describe('TopicDoctorRepo', () => {
  it('skips a reparent operation whose parent is not a real message in the topic', async () => {
    await serverDB.insert(messages).values({
      content: 'stranded question',
      id: 'u2',
      role: 'user',
      topicId,
      userId,
    });

    const repo = new TopicDoctorRepo(serverDB, userId);
    vi.spyOn(repo, 'diagnose').mockResolvedValue({
      hiddenCount: 0,
      issues: [
        {
          hiddenMessageIds: [],
          kind: 'segment-split',
          messageId: 'u2',
          reattachedMessageIds: ['u2'],
          repairable: true,
        },
      ],
      patch: [{ messageId: 'u2', parentId: 'mg1', type: 'reparent' }],
    });

    const result = await repo.repair({ topicId });

    expect(result.applied).toBe(0);
    expect(result.restoredMessageIds).toEqual([]);
    const row = await serverDB.query.messages.findFirst({
      where: (table, { eq }) => eq(table.id, 'u2'),
    });
    expect(row?.parentId).toBeNull();
  });

  it('applies a reparent operation when both messages belong to the topic', async () => {
    await serverDB.insert(messages).values([
      { content: 'previous answer', id: 'a1', role: 'assistant', topicId, userId },
      { content: 'stranded question', id: 'u2', role: 'user', topicId, userId },
    ]);

    const repo = new TopicDoctorRepo(serverDB, userId);
    vi.spyOn(repo, 'diagnose').mockResolvedValue({
      hiddenCount: 0,
      issues: [
        {
          hiddenMessageIds: [],
          kind: 'segment-split',
          messageId: 'u2',
          reattachedMessageIds: ['u2'],
          repairable: true,
        },
      ],
      patch: [{ messageId: 'u2', parentId: 'a1', type: 'reparent' }],
    });

    const result = await repo.repair({ topicId });

    expect(result.applied).toBe(1);
    expect(result.restoredMessageIds).toEqual(['u2']);
    const row = await serverDB.query.messages.findFirst({
      where: (table, { eq }) => eq(table.id, 'u2'),
    });
    expect(row?.parentId).toBe('a1');
  });
});
