import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messageGroups, messages, threads, topics, users } from '../../schemas';
import { CompressionRepository } from './index';

const db = await getTestDB();
const userId = 'compression-scope-owner';
const repo = new CompressionRepository(db, userId);
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(topics).values([
    { id: 'scope-topic', userId },
    { id: 'other-topic', userId },
  ]);
  await db.insert(messages).values([
    { id: 'scope-message', userId, topicId: 'scope-topic', role: 'user', content: 'keep' },
    {
      id: 'other-message',
      userId,
      topicId: 'other-topic',
      role: 'user',
      content: 'private elsewhere',
    },
  ]);
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});
const create = (messageIds: string[]) =>
  repo.createCompressionGroup({ topicId: 'scope-topic', content: '...', messageIds, metadata: {} });

it('rejects a mixed-topic selection without creating a group or hiding any messages', async () => {
  await expect(create(['scope-message', 'other-message'])).rejects.toThrow();
  expect(await db.select().from(messageGroups).where(eq(messageGroups.userId, userId))).toEqual([]);
  const rows = await db.select().from(messages).where(eq(messages.userId, userId));
  expect(rows.every((row) => row.messageGroupId === null)).toBe(true);
});
it('does not move a message into a second simultaneous compression', async () => {
  const groupId = await create(['scope-message']);
  await expect(create(['scope-message'])).rejects.toThrow();
  const row = await db.query.messages.findFirst({ where: eq(messages.id, 'scope-message') });
  expect(row?.messageGroupId).toBe(groupId);
});
it('does not finalize an empty summary over the source history', async () => {
  const groupId = await create(['scope-message']);
  await expect(
    repo.finalizeCompressionGroup({ groupId, topicId: 'scope-topic', content: ' \n ' }),
  ).rejects.toThrow();
  const row = await db.query.messageGroups.findFirst({ where: eq(messageGroups.id, groupId) });
  expect(row?.content).toBe('...');
});

it('does not consume a prior summary from another thread', async () => {
  await db
    .insert(threads)
    .values({ type: 'standalone', id: 'foreign-thread', userId, topicId: 'scope-topic' });
  await db
    .update(messages)
    .set({ threadId: 'foreign-thread' })
    .where(eq(messages.id, 'scope-message'));
  const source = await repo.createCompressionGroup({
    topicId: 'scope-topic',
    threadId: 'foreign-thread',
    content: 'prior',
    messageIds: ['scope-message'],
    metadata: {},
  });
  await expect(
    repo.createCompressionGroup({
      topicId: 'scope-topic',
      content: '...',
      messageIds: [],
      sourceGroupIds: [source],
      metadata: {},
    }),
  ).rejects.toThrow();
  const row = await db.query.messages.findFirst({ where: eq(messages.id, 'scope-message') });
  expect(row?.messageGroupId).toBe(source);
});
it('does not commit a summary after one of its source groups has disappeared', async () => {
  const groupId = await create(['scope-message']);
  await expect(
    repo.finalizeCompressionGroup({
      groupId,
      topicId: 'scope-topic',
      content: 'combined',
      sourceGroupIds: ['missing-group'],
    }),
  ).rejects.toThrow();
  expect(
    (await db.query.messageGroups.findFirst({ where: eq(messageGroups.id, groupId) }))?.content,
  ).toBe('...');
});

it('does not cancel a group through another topic scope', async () => {
  const groupId = await create(['scope-message']);
  await expect(repo.deleteCompressionGroup(groupId, { topicId: 'other-topic' })).rejects.toThrow();
  expect(
    (await db.query.messages.findFirst({ where: eq(messages.id, 'scope-message') }))
      ?.messageGroupId,
  ).toBe(groupId);
  expect(
    await db.query.messageGroups.findFirst({ where: eq(messageGroups.id, groupId) }),
  ).toBeDefined();
});
