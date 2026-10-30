import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, threads, topics, users } from '../../../schemas';
import { MessageModel } from '../../message';

const db = await getTestDB();
const userId = 'spine-operation-user';
const otherUserId = 'spine-operation-other';
const model = new MessageModel(db, userId);
const topicId = 'spine-operation-topic';
const threadId = 'spine-operation-thread';

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(topics).values({ id: topicId, userId });
  await db.insert(threads).values({ id: threadId, topicId, type: 'isolation', userId });
});
afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('operation-scoped message spine', () => {
  it('ignores a newer assistant from another run and keeps topic-wide reads unchanged', async () => {
    await db.insert(messages).values([
      {
        id: 'own-step',
        userId,
        topicId,
        role: 'assistant',
        metadata: { operationId: 'new-run' },
        createdAt: new Date(1000),
      },
      {
        id: 'late-old-step',
        userId,
        topicId,
        role: 'assistant',
        metadata: { operationId: 'old-run' },
        createdAt: new Date(2000),
      },
      { id: 'legacy-step', userId, topicId, role: 'assistant', createdAt: new Date(3000) },
    ]);
    expect(await model.getLatestSpineMessageId({ topicId, operationId: 'new-run' })).toBe(
      'own-step',
    );
    expect(await model.getLatestSpineMessageId({ topicId })).toBe('legacy-step');
    expect(await model.getLatestSpineMessageId({ topicId, operationId: 'absent' })).toBeUndefined();
    expect(
      await new MessageModel(db, otherUserId).getLatestSpineMessageId({
        topicId,
        operationId: 'new-run',
      }),
    ).toBeUndefined();
  });

  it('keeps tool and signal exclusions and thread isolation within an operation', async () => {
    await db.insert(messages).values([
      {
        id: 'own-step',
        userId,
        topicId,
        role: 'assistant',
        metadata: { operationId: 'run' },
        createdAt: new Date(1000),
      },
      {
        id: 'own-tool',
        userId,
        topicId,
        role: 'tool',
        metadata: { operationId: 'run' },
        createdAt: new Date(2000),
      },
      {
        id: 'own-signal',
        userId,
        topicId,
        role: 'assistant',
        metadata: { operationId: 'run', signal: { type: 'tool-stdout' } },
        createdAt: new Date(3000),
      },
      {
        id: 'thread-step',
        userId,
        topicId,
        threadId,
        role: 'assistant',
        metadata: { operationId: 'run' },
        createdAt: new Date(4000),
      },
    ]);
    expect(await model.getLatestSpineMessageId({ topicId, operationId: 'run' })).toBe('own-step');
    expect(await model.getLatestSpineMessageId({ topicId, threadId, operationId: 'run' })).toBe(
      'thread-step',
    );
  });
});
