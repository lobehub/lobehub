import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { MessageModel } from '../../../models/message';
import { messageContextSnapshots, messages, topics, users, workspaces } from '../../../schemas';
import { TopicRepository } from '../index';

const db = await getTestDB();
const userId = 'fork-context-owner';
const repo = new TopicRepository(db, userId);
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(topics).values({ id: 'source', userId, metadata: { conversationMode: 'chat' } });
  await db.insert(messages).values([
    { id: 'u1', userId, topicId: 'source', role: 'user', content: 'first', createdAt: new Date(1) },
    {
      id: 'a1',
      userId,
      topicId: 'source',
      role: 'assistant',
      parentId: 'u1',
      createdAt: new Date(2),
    },
    { id: 'u2', userId, topicId: 'source', role: 'user', parentId: 'a1', createdAt: new Date(3) },
  ]);
  await new MessageModel(db, userId).commitContextReplay('a1', {
    invocationId: 'a1',
    sessionKey: 'model:actor',
    historyStartId: 'u1',
    version: 1,
    sourceIds: ['goal:g1', 'document:private'],
    system: [{ role: 'system', content: 'PERSONA' }],
    changes: [
      {
        key: 'DocumentReferenceContextInjector:u1',
        sourceIds: ['document:private'],
        messages: [{ id: 'stable-goal-event', role: 'user', content: 'GOAL ORIGINAL' }],
      },
    ],
  });
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, 'fork-workspace'));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, 'other-author'));
});

it('copies only dependency metadata when duplicating another author in a shared workspace', async () => {
  await db.insert(users).values({ id: 'other-author' });
  await db
    .insert(workspaces)
    .values({ id: 'fork-workspace', name: 'Fork', slug: 'fork-workspace', primaryOwnerId: userId });
  await db.update(topics).set({ workspaceId: 'fork-workspace' }).where(eq(topics.id, 'source'));
  await db
    .update(messages)
    .set({ workspaceId: 'fork-workspace', userId: 'other-author' })
    .where(eq(messages.topicId, 'source'));
  await db
    .update(messageContextSnapshots)
    .set({ workspaceId: 'fork-workspace', userId: 'other-author' })
    .where(eq(messageContextSnapshots.messageId, 'a1'));
  const result = await new TopicRepository(db, userId, 'fork-workspace').duplicate('source');
  const assistant = result.messages.find((message) => message.role === 'assistant')!;
  const replay = (
    await new MessageModel(db, userId, 'fork-workspace').getContextReplays([assistant.id])
  )[assistant.id];
  expect(replay.sourceIds).toEqual(['goal:g1', 'document:private']);
  expect(replay.createdBy).toBe('other-author');
  expect(JSON.stringify(replay)).not.toContain('PERSONA');
  expect(JSON.stringify(replay)).not.toContain('GOAL ORIGINAL');
});

for (const path of ['duplicate', 'edit-resend'] as const) {
  it(`${path} preserves the locked mode and remaps the private replay graph`, async () => {
    const result =
      path === 'duplicate'
        ? await repo.duplicate('source')
        : await repo.branchAtMessage('source', 'u2', { content: 'edited' });
    expect(result?.topic.metadata?.conversationMode).toBe('chat');
    const rows = await db.select().from(messages).where(eq(messages.topicId, result!.topic.id));
    const assistant = rows.find((row) => row.role === 'assistant')!;
    const user = rows.find((row) => row.content === 'first')!;
    const [stored] = await db
      .select()
      .from(messageContextSnapshots)
      .where(eq(messageContextSnapshots.messageId, assistant.id));
    expect(stored?.snapshot).toMatchObject({
      invocationId: assistant.id,
      historyStartId: user.id,
      sourceIds: ['goal:g1', 'document:private'],
      system: [{ role: 'system', content: 'PERSONA' }],
      changes: [
        {
          key: `DocumentReferenceContextInjector:${user.id}`,
          messages: [{ id: 'stable-goal-event', content: 'GOAL ORIGINAL' }],
        },
      ],
    });
  });
}
