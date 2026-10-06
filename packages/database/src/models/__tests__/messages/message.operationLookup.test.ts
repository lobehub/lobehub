// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'op-msg-lookup-user';
const otherUserId = 'op-msg-lookup-other';
const topicId = 'op-msg-lookup-topic';
const otherTopicId = 'op-msg-lookup-topic-other';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: otherTopicId, userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.findLatestAssistantByOperationId', () => {
  it('resolves the newest assistant row stamped with the operation provenance', async () => {
    await messageModel.create({
      content: 'step 1 (tool call)',
      metadata: { operationId: 'op-1' },
      role: 'assistant',
      topicId,
    });
    const final = await messageModel.create({
      content: 'final reply',
      metadata: { operationId: 'op-1' },
      role: 'assistant',
      topicId,
    });

    const found = await messageModel.findLatestAssistantByOperationId({
      operationId: 'op-1',
      topicId,
    });

    expect(found?.id).toBe(final.id);
    expect(found?.content).toBe('final reply');
  });

  it('does not return rows of another operation in the same topic', async () => {
    await messageModel.create({
      content: 'previous turn reply',
      metadata: { operationId: 'op-old' },
      role: 'assistant',
      topicId,
    });

    const found = await messageModel.findLatestAssistantByOperationId({
      operationId: 'op-new',
      topicId,
    });

    expect(found).toBeUndefined();
  });

  it('ignores non-assistant rows and rows in other topics', async () => {
    await messageModel.create({
      content: 'user text',
      metadata: { operationId: 'op-2' },
      role: 'user',
      topicId,
    });
    await messageModel.create({
      content: 'assistant in another topic',
      metadata: { operationId: 'op-2' },
      role: 'assistant',
      topicId: otherTopicId,
    });

    const found = await messageModel.findLatestAssistantByOperationId({
      operationId: 'op-2',
      topicId,
    });

    expect(found).toBeUndefined();
  });

  it('is scoped to the owning user', async () => {
    await messageModel.create({
      content: 'mine',
      metadata: { operationId: 'op-3' },
      role: 'assistant',
      topicId,
    });

    const asOther = await new MessageModel(serverDB, otherUserId).findLatestAssistantByOperationId({
      operationId: 'op-3',
      topicId,
    });

    expect(asOther).toBeUndefined();
  });

  it('does not return a reply in the recycle bin', async () => {
    const message = await messageModel.create({
      content: 'trashed reply',
      metadata: { operationId: 'op-trashed' },
      role: 'assistant',
      topicId,
    });
    await serverDB
      .update(messages)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(messages.id, message.id));

    await expect(
      messageModel.findLatestAssistantByOperationId({
        operationId: 'op-trashed',
        topicId,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not return a reply whose topic is in the recycle bin', async () => {
    await messageModel.create({
      content: 'reply under trashed topic',
      metadata: { operationId: 'op-trashed-topic' },
      role: 'assistant',
      topicId,
    });
    await serverDB
      .update(topics)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(topics.id, topicId));

    await expect(
      messageModel.findLatestAssistantByOperationId({
        operationId: 'op-trashed-topic',
        topicId,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('MessageModel.findVerifyMessageByOperationId', () => {
  it('resolves a verify card under a live topic', async () => {
    const verifyMessage = await messageModel.create({
      content: 'verify result',
      metadata: { verifyOperationId: 'verify-live-topic' },
      role: 'verify',
      topicId,
    });

    await expect(
      messageModel.findVerifyMessageByOperationId('verify-live-topic'),
    ).resolves.toMatchObject({ id: verifyMessage.id });
  });

  it('does not resolve a verify card whose parent topic is in the recycle bin', async () => {
    await messageModel.create({
      content: 'hidden verify result',
      metadata: { verifyOperationId: 'verify-trashed-topic' },
      role: 'verify',
      topicId,
    });
    await serverDB
      .update(topics)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(topics.id, topicId));

    await expect(
      messageModel.findVerifyMessageByOperationId('verify-trashed-topic'),
    ).resolves.toBeUndefined();
  });
});
