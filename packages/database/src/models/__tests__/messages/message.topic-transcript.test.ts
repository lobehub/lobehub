// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  chatGroups,
  messageGroups,
  messages,
  sessions,
  threads,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-transcript-user';
const otherUserId = 'topic-transcript-other-user';
const testUserIds = [userId, otherUserId];

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, testUserIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('MessageModel.queryTopicTranscript', () => {
  it('returns every persisted topic message with stable database pagination', async () => {
    const topicId = 'topic-transcript-target';
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    await serverDB.insert(sessions).values({ id: 'topic-transcript-session', userId });
    await serverDB.insert(chatGroups).values({ id: 'topic-transcript-chat-group', userId });
    await serverDB.insert(topics).values([
      { id: topicId, title: 'Transcript target', userId },
      { id: 'topic-transcript-other-topic', title: 'Other topic', userId },
    ]);
    await serverDB.insert(threads).values({
      id: 'topic-transcript-thread',
      topicId,
      type: 'continuation',
      userId,
    });
    await serverDB.insert(messageGroups).values({
      id: 'topic-transcript-message-group',
      topicId,
      type: 'parallel',
      userId,
    });
    await serverDB.insert(messages).values([
      {
        content: 'plain message',
        createdAt,
        id: 'topic-transcript-m-a',
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'legacy session message',
        createdAt,
        id: 'topic-transcript-m-b',
        role: 'assistant',
        sessionId: 'topic-transcript-session',
        topicId,
        userId,
      },
      {
        content: 'group message',
        createdAt,
        groupId: 'topic-transcript-chat-group',
        id: 'topic-transcript-m-c',
        role: 'supervisor',
        topicId,
        userId,
      },
      {
        content: 'thread message',
        createdAt,
        id: 'topic-transcript-m-d',
        role: 'task',
        threadId: 'topic-transcript-thread',
        topicId,
        userId,
      },
      {
        content: 'raw message-group member',
        createdAt,
        id: 'topic-transcript-m-e',
        messageGroupId: 'topic-transcript-message-group',
        role: 'assistant',
        tools: [
          {
            apiName: 'search',
            arguments: '{"query":"lobehub"}',
            id: 'topic-transcript-tool',
            identifier: 'web',
            type: 'default',
          },
        ],
        topicId,
        userId,
      },
      {
        content: 'different topic',
        createdAt,
        id: 'topic-transcript-other-topic-message',
        role: 'user',
        topicId: 'topic-transcript-other-topic',
        userId,
      },
      {
        content: 'different owner',
        createdAt,
        id: 'topic-transcript-other-owner-message',
        role: 'user',
        topicId,
        userId: otherUserId,
      },
    ]);

    const model = new MessageModel(serverDB, userId);
    const full = await model.queryTopicTranscript({ limit: 10, offset: 0, topicId });

    expect(full.total).toBe(5);
    expect(full.items.map(({ id }) => id)).toEqual([
      'topic-transcript-m-a',
      'topic-transcript-m-b',
      'topic-transcript-m-c',
      'topic-transcript-m-d',
      'topic-transcript-m-e',
    ]);
    expect(full.items[1]).toMatchObject({ content: 'legacy session message' });
    expect(full.items[2]).toMatchObject({ content: 'group message', role: 'supervisor' });
    expect(full.items[3]).toMatchObject({
      content: 'thread message',
      threadId: 'topic-transcript-thread',
    });
    expect(full.items[4]).toMatchObject({
      messageGroupId: 'topic-transcript-message-group',
      tools: [expect.objectContaining({ apiName: 'search', identifier: 'web' })],
    });

    const page = await model.queryTopicTranscript({ limit: 2, offset: 1, topicId });
    expect(page.total).toBe(5);
    expect(page.items.map(({ id }) => id)).toEqual([
      'topic-transcript-m-b',
      'topic-transcript-m-c',
    ]);

    await expect(
      new MessageModel(serverDB, otherUserId).queryTopicTranscript({
        limit: 10,
        offset: 0,
        topicId,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: 'topic-transcript-other-owner-message' })],
      total: 1,
    });
  });

  it('isolates personal and workspace transcripts for the same user', async () => {
    await serverDB.insert(workspaces).values([
      {
        id: 'topic-transcript-workspace-a',
        name: 'Workspace A',
        primaryOwnerId: userId,
        slug: 'topic-transcript-workspace-a',
      },
      {
        id: 'topic-transcript-workspace-b',
        name: 'Workspace B',
        primaryOwnerId: userId,
        slug: 'topic-transcript-workspace-b',
      },
    ]);
    await serverDB.insert(topics).values({
      id: 'topic-transcript-workspace-topic',
      title: 'Workspace transcript',
      userId,
      workspaceId: 'topic-transcript-workspace-a',
    });
    await serverDB.insert(messages).values({
      content: 'workspace A only',
      id: 'topic-transcript-workspace-message',
      role: 'user',
      topicId: 'topic-transcript-workspace-topic',
      userId,
      workspaceId: 'topic-transcript-workspace-a',
    });

    const input = {
      limit: 10,
      offset: 0,
      topicId: 'topic-transcript-workspace-topic',
    };

    await expect(
      new MessageModel(serverDB, userId, 'topic-transcript-workspace-a').queryTopicTranscript(
        input,
      ),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'topic-transcript-workspace-message' })],
      total: 1,
    });
    await expect(new MessageModel(serverDB, userId).queryTopicTranscript(input)).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(
      new MessageModel(serverDB, userId, 'topic-transcript-workspace-b').queryTopicTranscript(
        input,
      ),
    ).resolves.toEqual({ items: [], total: 0 });
  });
});
