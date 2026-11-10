import { MessageGroupType, ThreadStatus, ThreadType } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uuid } from '@/utils/uuid';

import { getTestDB } from '../../../core/getTestDB';
import {
  chunks,
  fileChunks,
  files,
  messageGroups,
  messageQueries,
  messageQueryChunks,
  messages,
  messagesFiles,
  messageTTS,
  threads,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { MessageByIdsQueries } from '../../message/queryByIds';
import { MessageRelationQueries } from '../../message/relations';
import type { MessageScopeArgs } from '../../message/scope';
import { exactTermPattern } from '../../message/search';
import { buildMessageSearchSnippet } from '../../message/searchSnippet';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-coverage-group-c';
const otherUserId = 'message-coverage-group-c-other';
const ghostUserId = 'message-coverage-group-c-ghost';
const topicId = 'cov-c-topic';

const messageModel = new MessageModel(serverDB, userId);

const byIdsQueries = (id = userId) => {
  const args: MessageScopeArgs = [serverDB, id, undefined, undefined, {}];
  return new MessageByIdsQueries(args, { relations: new MessageRelationQueries(...args) });
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, title: 'Coverage C', userId });
});

afterEach(async () => {
  await serverDB.delete(messages).where(eq(messages.userId, ghostUserId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.checkUsersHaveMessages', () => {
  it('short-circuits to an empty set for an empty user list', async () => {
    const result = await MessageModel.checkUsersHaveMessages(serverDB, []);

    expect(result).toEqual(new Set());
  });

  it('returns only the users that own at least one message', async () => {
    await serverDB.insert(messages).values([
      { content: 'a', id: 'cov-c-has-1', role: 'user', userId },
      { content: 'b', id: 'cov-c-has-2', role: 'assistant', userId },
    ]);

    const result = await MessageModel.checkUsersHaveMessages(serverDB, [userId, otherUserId]);

    expect(result).toEqual(new Set([userId]));
  });
});

describe('MessageByIdsQueries.queryByIds', () => {
  it('returns [] when none of the requested ids are visible to the caller', async () => {
    await serverDB
      .insert(messages)
      .values({ content: 'foreign', id: 'cov-c-foreign', role: 'user', userId: otherUserId });

    const result = await messageModel.queryByIds(['cov-c-foreign', 'cov-c-missing']);

    expect(result).toEqual([]);
  });

  it('hydrates task details, TTS, video attachments and null-similarity chunks', async () => {
    const queryId = uuid();
    const chunkId = uuid();

    await serverDB.insert(messages).values([
      {
        content: 'task with titled thread',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        id: 'cov-c-task-1',
        role: 'task',
        topicId,
        userId,
      },
      {
        content: 'task with untitled thread',
        createdAt: new Date('2024-01-01T00:00:01Z'),
        id: 'cov-c-task-2',
        role: 'task',
        topicId,
        userId,
      },
      {
        content: 'assistant with media',
        createdAt: new Date('2024-01-01T00:00:02Z'),
        id: 'cov-c-media',
        role: 'assistant',
        topicId,
        userId,
      },
    ]);
    await serverDB.insert(threads).values([
      {
        id: 'cov-c-thread-1',
        metadata: { duration: 1200, totalMessages: 4, totalTokens: 900 },
        sourceMessageId: 'cov-c-task-1',
        status: ThreadStatus.Completed,
        title: 'Titled task',
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
      {
        id: 'cov-c-thread-2',
        sourceMessageId: 'cov-c-task-2',
        status: ThreadStatus.Processing,
        topicId,
        type: ThreadType.Isolation,
        userId,
      },
    ]);
    await serverDB.insert(files).values({
      fileType: 'video/mp4',
      id: 'cov-c-video',
      name: 'clip.mp4',
      size: 2048,
      url: 'videos/clip.mp4',
      userId,
    });
    await serverDB
      .insert(messagesFiles)
      .values({ fileId: 'cov-c-video', messageId: 'cov-c-media', userId });
    await serverDB.insert(messageTTS).values({
      contentMd5: 'md5',
      fileId: 'cov-c-video',
      id: 'cov-c-media',
      voice: 'alloy',
      userId,
    });
    await serverDB.insert(chunks).values({ id: chunkId, text: 'chunk text', userId });
    await serverDB.insert(fileChunks).values({ chunkId, fileId: 'cov-c-video', userId });
    await serverDB.insert(messageQueries).values({
      id: queryId,
      messageId: 'cov-c-media',
      rewriteQuery: 'rewritten',
      userId,
      userQuery: 'raw',
    });
    await serverDB
      .insert(messageQueryChunks)
      .values({ chunkId, messageId: 'cov-c-media', queryId, similarity: null as any, userId });

    const postProcessUrl = vi.fn(async (path: string | null) => `https://cdn/${path}`);
    const result = await messageModel.queryByIds(['cov-c-task-1', 'cov-c-task-2', 'cov-c-media'], {
      postProcessUrl,
    });

    expect(result.map((m) => m.id)).toEqual(['cov-c-task-1', 'cov-c-task-2', 'cov-c-media']);

    const [titled, untitled, media] = result as any[];
    expect(titled.taskDetail).toEqual({
      clientMode: undefined,
      duration: 1200,
      status: ThreadStatus.Completed,
      threadId: 'cov-c-thread-1',
      title: 'Titled task',
      totalCost: undefined,
      totalMessages: 4,
      totalTokens: 900,
      totalToolCalls: undefined,
    });
    expect(untitled.taskDetail).toMatchObject({
      status: ThreadStatus.Processing,
      threadId: 'cov-c-thread-2',
      title: undefined,
    });

    expect(media.taskDetail).toBeUndefined();
    expect(media.extra.tts).toEqual({ contentMd5: 'md5', file: 'cov-c-video', voice: 'alloy' });
    expect(media.videoList).toEqual([
      { alt: 'clip.mp4', id: 'cov-c-video', url: 'https://cdn/videos/clip.mp4' },
    ]);
    expect(media.chunksList).toHaveLength(1);
    expect(media.chunksList[0].similarity).toBeUndefined();
    expect(media.ragQuery).toBe('rewritten');
    expect(media.ragRawQuery).toBe('raw');
  });

  it('collapses the sender to null when the author account row no longer exists', async () => {
    // Simulate a message whose author account is gone: bypass the FK so the
    // `users` left join finds no row and drizzle yields a null-id sender.
    await serverDB.transaction(async (trx) => {
      await trx.execute(sql`SET LOCAL session_replication_role = replica`);
      await trx
        .insert(messages)
        .values({ content: 'orphan', id: 'cov-c-orphan', role: 'user', userId: ghostUserId });
    });

    const [message] = await new MessageModel(serverDB, ghostUserId).queryByIds(['cov-c-orphan']);

    expect(message.id).toBe('cov-c-orphan');
    expect(message.sender).toBeNull();
  });
});

describe('MessageByIdsQueries.queryMessageGroupNodes', () => {
  const seedCompressionGroup = async () => {
    await serverDB.insert(messages).values([
      {
        content: 'compressed one',
        createdAt: new Date('2024-01-01T10:00:00Z'),
        id: 'cov-c-group-m1',
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'compressed two',
        createdAt: new Date('2024-01-01T10:01:00Z'),
        id: 'cov-c-group-m2',
        role: 'assistant',
        topicId,
        userId,
      },
    ]);
    await serverDB.insert(messageGroups).values({
      content: 'Summary of the early turns',
      createdAt: new Date('2024-01-01T10:02:00Z'),
      id: 'cov-c-group',
      topicId,
      type: MessageGroupType.Compression,
      userId,
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'cov-c-group' })
      .where(eq(messages.topicId, topicId));
  };

  it('applies the default visitor exclusion when no opt-in is passed', async () => {
    await seedCompressionGroup();

    const nodes = (await byIdsQueries().queryMessageGroupNodes(topicId)) as any[];

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      content: 'Summary of the early turns',
      id: 'cov-c-group',
      role: 'compressedGroup',
    });
    expect(nodes[0].compressedMessages.map((m: { id: string }) => m.id)).toEqual([
      'cov-c-group-m1',
      'cov-c-group-m2',
    ]);
  });

  it('returns no nodes for a topic the caller does not own', async () => {
    await seedCompressionGroup();

    const nodes = await byIdsQueries(otherUserId).queryMessageGroupNodes(topicId);

    expect(nodes).toEqual([]);
  });
});

describe('MessageScope guards reached through MessageModel', () => {
  it('fails closed for a topicId that does not exist in the caller scope', async () => {
    await serverDB
      .insert(messages)
      .values({ content: 'in topic', id: 'cov-c-in-topic', role: 'user', topicId, userId });

    const result = await messageModel.query({ topicId: 'cov-c-missing-topic' });

    expect(result).toEqual([]);
  });

  it('narrows the topic message tree to the requested thread', async () => {
    await serverDB.insert(threads).values({
      id: 'cov-c-tree-thread',
      topicId,
      type: ThreadType.Standalone,
      userId,
    });
    await serverDB.insert(messages).values([
      { content: 'main', id: 'cov-c-tree-main', role: 'user', topicId, userId },
      {
        content: 'thread',
        id: 'cov-c-tree-thread-msg',
        parentId: 'cov-c-tree-main',
        role: 'assistant',
        threadId: 'cov-c-tree-thread',
        topicId,
        userId,
      },
    ]);

    const tree = await messageModel.queryTopicMessageTree({
      threadId: 'cov-c-tree-thread',
      topicId,
    });

    expect(tree).toEqual([
      { id: 'cov-c-tree-thread-msg', messageGroupId: null, parentId: 'cov-c-tree-main' },
    ]);
  });
});

describe('MessageModel.searchByKeyword guards', () => {
  it('returns an empty page for a whitespace-only keyword without querying', async () => {
    const ftsSearchCandidates = vi.fn();
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates,
    });

    const result = await model.searchByKeyword({ keyword: '   ' });

    expect(result).toEqual({ hasMore: false, items: [], truncated: false });
    expect(ftsSearchCandidates).not.toHaveBeenCalled();
  });

  it('builds the snippet from the summary when content is empty', async () => {
    await serverDB.insert(messages).values({
      content: '',
      id: 'cov-c-summary-only',
      role: 'assistant',
      summary: 'compressed summary mentions rollout',
      topicId,
      userId,
    });
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: vi
        .fn()
        .mockResolvedValue({ candidates: [{ id: 'cov-c-summary-only', score: 1 }], total: 1 }),
    });

    const result = await model.searchByKeyword({ keyword: 'compressed' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      contentLength: 'compressed summary mentions rollout'.length,
      id: 'cov-c-summary-only',
      snippet: 'compressed summary mentions rollout',
    });
  });
});

describe('exactTermPattern', () => {
  it('omits the leading word boundary when the term starts with a non-word character', () => {
    expect(exactTermPattern('.net')).toBe('\\.net([^A-Za-z0-9_]|$)');
  });

  it('omits both boundaries for a CJK term', () => {
    expect(exactTermPattern('部署')).toBe('部署');
  });
});

describe('buildMessageSearchSnippet', () => {
  it('returns the head of the text with zero matches for a blank keyword', () => {
    const content = 'x'.repeat(200);

    const result = buildMessageSearchSnippet(content, '   ', 10);

    expect(result).toEqual({ matchCount: 0, snippet: `${'x'.repeat(20)}…` });
  });
});
