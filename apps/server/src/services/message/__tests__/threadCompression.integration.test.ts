// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentsToSessions,
  messageGroups,
  messages,
  sessions,
  threads,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { MessageGroupType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';

import { MessageService } from '../index';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFileAccessUrl: vi.fn().mockResolvedValue(''),
      getFullFileUrl: vi.fn().mockReturnValue(null),
    };
  }),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'thread-compression-integration-test';
const agentId = 'agent-1';
const topicId = 'topic-1';
const threadId = 'thread-1';

const at = (minute: number) => new Date(`2024-01-01T10:${String(minute).padStart(2, '0')}:00Z`);

/**
 * Main conversation: round 1 (`main-user-1` → `main-assistant-1`), then a later round 2.
 * A continuation thread branches from `main-assistant-1` and has two rounds of its own.
 */
beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
  await serverDB.insert(sessions).values({ id: 'session-1', userId });
  await serverDB.insert(agentsToSessions).values({ agentId, sessionId: 'session-1', userId });
  await serverDB.insert(topics).values({ id: topicId, sessionId: 'session-1', userId });

  const message = (id: string, role: string, minute: number, inThread = false) => ({
    agentId,
    content: id,
    createdAt: at(minute),
    id,
    role,
    threadId: inThread ? threadId : undefined,
    topicId,
    userId,
  });
  await serverDB
    .insert(messages)
    .values([message('main-user-1', 'user', 0), message('main-assistant-1', 'assistant', 1)]);
  await serverDB.insert(threads).values({
    id: threadId,
    sourceMessageId: 'main-assistant-1',
    topicId,
    type: 'continuation',
    userId,
  });
  await serverDB
    .insert(messages)
    .values([
      message('thread-user-1', 'user', 2, true),
      message('thread-assistant-1', 'assistant', 3, true),
      message('thread-user-2', 'user', 4, true),
      message('thread-assistant-2', 'assistant', 5, true),
      message('main-user-2', 'user', 6),
      message('main-assistant-2', 'assistant', 7),
    ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

const threadMessageIds = [
  'thread-user-1',
  'thread-assistant-1',
  'thread-user-2',
  'thread-assistant-2',
];

describe('compressing a thread', () => {
  it('summarizes and folds only the thread, leaving the main conversation intact', async () => {
    const service = new MessageService(serverDB, userId);
    const scope = { agentId, threadId, topicId };

    // The thread page lists the parent turn it branched from before its own turns.
    const created = await service.createCompressionGroup(
      topicId,
      ['main-user-1', 'main-assistant-1', ...threadMessageIds],
      scope,
    );

    expect(created.messagesToSummarize.map((m) => m.id)).toEqual(threadMessageIds);

    const finalized = await service.finalizeCompression(
      created.messageGroupId,
      'thread summary',
      scope,
    );

    // The thread keeps its parent turn above its own summary.
    expect(finalized.messages!.map((m) => [m.id, m.role])).toEqual([
      ['main-user-1', 'user'],
      ['main-assistant-1', 'assistant'],
      [created.messageGroupId, 'compressedGroup'],
    ]);
    expect(finalized.messages!.at(-1)).toMatchObject({ content: 'thread summary', threadId });

    // The main conversation still shows every turn and none of the thread's summary.
    const main = await new MessageModel(serverDB, userId).query({ agentId, topicId });
    expect(main.map((m) => m.id)).toEqual([
      'main-user-1',
      'main-assistant-1',
      'main-user-2',
      'main-assistant-2',
    ]);
  });

  it('keeps main-conversation summaries out of the thread and out of its compaction', async () => {
    const service = new MessageService(serverDB, userId);
    await serverDB.insert(messageGroups).values({
      content: 'main summary',
      createdAt: at(8),
      id: 'main-group',
      topicId,
      type: MessageGroupType.Compression,
      userId,
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'main-group' })
      .where(eq(messages.id, 'main-user-2'));

    const scope = { agentId, threadId, topicId };
    const threadPage = await new MessageModel(serverDB, userId).query(scope);
    expect(threadPage.some((m) => m.id === 'main-group')).toBe(false);

    const created = await service.createCompressionGroup(topicId, threadMessageIds, scope);
    // A stale client can still name the main summary as a group to supersede.
    await service.finalizeCompression(created.messageGroupId, 'thread summary', {
      ...scope,
      sourceGroupIds: ['main-group'],
    });

    const [mainGroup] = await serverDB
      .select()
      .from(messageGroups)
      .where(eq(messageGroups.id, 'main-group'));
    expect(mainGroup?.content).toBe('main summary');
    const [mainMember] = await serverDB
      .select({ messageGroupId: messages.messageGroupId })
      .from(messages)
      .where(eq(messages.id, 'main-user-2'));
    expect(mainMember.messageGroupId).toBe('main-group');
  });
});
