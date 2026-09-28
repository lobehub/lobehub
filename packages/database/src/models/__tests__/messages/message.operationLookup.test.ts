// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { topics, users } from '../../../schemas';
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
});
