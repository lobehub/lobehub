// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { MessageModel } from '@/database/models/message';
import { messageGroups, messages, threads, topics, users } from '@/database/schemas';

import { MessageService } from '../index';

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (path: string) => path;
  },
}));
const db = await getTestDB();
const userId = 'compression-service-scope';
const service = new MessageService(db, userId);
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db.insert(topics).values({ id: 'compression-topic', userId });
  await db.insert(threads).values([
    { type: 'standalone', id: 'selected-thread', userId, topicId: 'compression-topic' },
    { type: 'standalone', id: 'other-thread', userId, topicId: 'compression-topic' },
  ]);
  await db.insert(messages).values([
    { id: 'scope-u', userId, topicId: 'compression-topic', role: 'user', content: 'question' },
    {
      id: 'scope-a',
      userId,
      topicId: 'compression-topic',
      role: 'assistant',
      content: 'PRIVATE DERIVED ANSWER',
    },
    {
      id: 'other-thread-message',
      userId,
      topicId: 'compression-topic',
      threadId: 'other-thread',
      role: 'user',
      content: 'other thread',
    },
  ]);
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});
it('does not hide another thread message under the requested thread summary', async () => {
  await expect(
    service.createCompressionGroup('compression-topic', ['other-thread-message'], {
      threadId: 'selected-thread',
    }),
  ).rejects.toThrow();
  const row = await db.query.messages.findFirst({ where: eq(messages.id, 'other-thread-message') });
  expect(row?.messageGroupId).toBeNull();
});
it('refuses revoked input before returning text to the compression model', async () => {
  await new MessageModel(db, userId).commitContextReplay('scope-a', {
    invocationId: 'scope-a',
    sessionKey: 'openai:model:agent',
    version: 1,
    changes: [],
    sourceIds: ['document:revoked'],
  });
  await expect(
    service.createCompressionGroup('compression-topic', ['scope-u', 'scope-a']),
  ).rejects.toThrow(/source|access|revok/i);
  expect(
    await db.select().from(messageGroups).where(eq(messageGroups.topicId, 'compression-topic')),
  ).toEqual([]);
});

it('rechecks source permissions before committing the generated summary', async () => {
  const result = await service.createCompressionGroup('compression-topic', ['scope-u', 'scope-a']);
  await new MessageModel(db, userId).commitContextReplay('scope-a', {
    invocationId: 'scope-a',
    sessionKey: 'openai:model:agent',
    version: 1,
    changes: [],
    sourceIds: ['document:revoked'],
  });
  await expect(
    service.finalizeCompression(result.messageGroupId, 'derived summary', {
      agentId: 'test-agent',
      topicId: 'compression-topic',
    }),
  ).rejects.toThrow(/source|access|revok/i);
  await service.cancelCompression(result.messageGroupId, { topicId: 'compression-topic' });
  expect(
    (await db.query.messages.findFirst({ where: eq(messages.id, 'scope-a') }))?.messageGroupId,
  ).toBeNull();
});

it('restores the original messages if refreshing the new group fails', async () => {
  const query = vi
    .spyOn((service as unknown as { messageModel: MessageModel }).messageModel, 'query')
    .mockRejectedValueOnce(new Error('refresh failed'));
  await expect(
    service.createCompressionGroup('compression-topic', ['scope-u', 'scope-a']),
  ).rejects.toThrow('refresh failed');
  query.mockRestore();
  expect(
    await db.select().from(messageGroups).where(eq(messageGroups.topicId, 'compression-topic')),
  ).toEqual([]);
  expect(
    (await db.query.messages.findFirst({ where: eq(messages.id, 'scope-a') }))?.messageGroupId,
  ).toBeNull();
});
