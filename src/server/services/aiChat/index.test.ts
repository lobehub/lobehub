// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import {
  agents,
  agentsToSessions,
  chatGroups,
  messages,
  sessions,
  threads,
  topics,
  users,
} from '@/database/schemas';
import { FileService } from '@/server/services/file';

import { AiChatService } from '.';

vi.mock('@/database/models/message');
vi.mock('@/database/models/topic');
vi.mock('@/server/services/file');

const userId = 'ai-chat-service-test-user';
const sessionId = 'ai-chat-service-session';
const agentId = 'ai-chat-service-agent';
const groupId = 'ai-chat-service-group';
const existingTopicId = 'ai-chat-service-topic';
const threadId = 'ai-chat-service-thread';

const serverDB: LobeChatDatabase = await getTestDB();

describe('AiChatService', () => {
  const seedBase = async () => {
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(sessions).values({ id: sessionId, title: 'Session', userId });
    await serverDB.insert(agents).values({ id: agentId, title: 'Agent', userId });
    await serverDB.insert(agentsToSessions).values({ agentId, sessionId, userId });
  };

  const seedGroup = async () => {
    await serverDB.insert(chatGroups).values({ id: groupId, title: 'Group', userId });
  };

  const getMessagesByTopicId = async (topicId: string) => {
    const rows = await serverDB.select().from(messages).where(eq(messages.topicId, topicId));

    return rows.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await serverDB.delete(users);
  });

  it('createSimpleNewTopicTurn should persist the simple turn through the Drizzle CTE', async () => {
    await seedBase();

    const service = new AiChatService(serverDB, userId);

    const res = await service.createSimpleNewTopicTurn({
      agentId,
      assistantMessage: {
        content: 'loading',
        metadata: {},
        model: 'gpt-4o',
        provider: 'openai',
      },
      topic: { title: 'T' },
      userMessage: {
        content: 'hi',
        editorData: { type: 'doc' },
        metadata: {},
      },
    });

    const [createdTopic] = await serverDB.select().from(topics).where(eq(topics.id, res.topicId));
    const createdMessages = await getMessagesByTopicId(res.topicId);
    const [updatedAgent] = await serverDB.select().from(agents).where(eq(agents.id, agentId));

    expect(res.topicId).toMatch(/^tpc_/);
    expect(res.resolvedSessionId).toBe(sessionId);
    expect(createdTopic).toEqual(
      expect.objectContaining({
        agentId,
        sessionId,
        title: 'T',
        userId,
      }),
    );
    expect(createdMessages).toHaveLength(2);
    expect(res.userMessage).toEqual(
      expect.objectContaining({
        content: 'hi',
        editorData: { type: 'doc' },
        sessionId,
        role: 'user',
        topicId: res.topicId,
        userId,
      }),
    );
    expect(res.assistantMessage).toEqual(
      expect.objectContaining({
        content: 'loading',
        model: 'gpt-4o',
        parentId: res.userMessage.id,
        provider: 'openai',
        role: 'assistant',
        sessionId,
      }),
    );
    expect(createdMessages.map((message) => message.id)).toEqual([
      res.userMessage.id,
      res.assistantMessage.id,
    ]);
    expect(updatedAgent.updatedAt.getTime()).toBeGreaterThan(updatedAgent.createdAt.getTime());
  });

  it('createSimpleNewTopicTurn should keep group messages detached from session rows', async () => {
    await seedBase();
    await seedGroup();

    const service = new AiChatService(serverDB, userId);

    const res = await service.createSimpleNewTopicTurn({
      agentId,
      assistantMessage: { content: 'loading' },
      groupId,
      topic: { title: 'T' },
      userMessage: { content: 'hi' },
    });

    const createdMessages = await getMessagesByTopicId(res.topicId);

    expect(res.resolvedSessionId).toBe(sessionId);
    expect(res.userMessage.sessionId).toBeNull();
    expect(res.assistantMessage.sessionId).toBeNull();
    expect(createdMessages).toHaveLength(2);
    expect(createdMessages).toEqual([
      expect.objectContaining({ groupId, id: res.userMessage.id, sessionId: null }),
      expect.objectContaining({ groupId, id: res.assistantMessage.id, sessionId: null }),
    ]);
  });

  it('createSimpleExistingTopicTurn should persist the simple turn through the Drizzle CTE', async () => {
    await seedBase();
    await serverDB.insert(topics).values({
      agentId,
      id: existingTopicId,
      sessionId,
      title: 'Existing Topic',
      userId,
    });
    await serverDB.insert(messages).values({
      content: 'parent',
      id: 'm-parent',
      role: 'user',
      sessionId,
      topicId: existingTopicId,
      userId,
    });

    const service = new AiChatService(serverDB, userId);

    const res = await service.createSimpleExistingTopicTurn({
      agentId,
      assistantMessage: {
        content: 'loading',
        metadata: {},
        model: 'gpt-4o',
        provider: 'openai',
      },
      topicId: existingTopicId,
      userMessage: {
        content: 'hi',
        editorData: { type: 'doc' },
        metadata: {},
        parentId: 'm-parent',
      },
    });

    const createdMessages = (await getMessagesByTopicId(existingTopicId)).filter(
      (message) => message.id !== 'm-parent',
    );
    const [updatedTopic] = await serverDB
      .select()
      .from(topics)
      .where(eq(topics.id, existingTopicId));

    expect(res.topicId).toBe(existingTopicId);
    expect(res.resolvedSessionId).toBe(sessionId);
    expect(updatedTopic.updatedAt.getTime()).toBeGreaterThan(updatedTopic.createdAt.getTime());
    expect(createdMessages).toHaveLength(2);
    expect(res.userMessage).toEqual(
      expect.objectContaining({
        content: 'hi',
        parentId: 'm-parent',
        role: 'user',
        sessionId,
        topicId: existingTopicId,
      }),
    );
    expect(res.assistantMessage).toEqual(
      expect.objectContaining({
        content: 'loading',
        model: 'gpt-4o',
        parentId: res.userMessage.id,
        provider: 'openai',
        role: 'assistant',
        sessionId,
      }),
    );
  });

  it('createSimpleExistingTopicTurn should throw when the topic does not exist for the user', async () => {
    await seedBase();

    const service = new AiChatService(serverDB, userId);

    await expect(
      service.createSimpleExistingTopicTurn({
        assistantMessage: { content: 'loading' },
        topicId: 't1',
        userMessage: { content: 'hi' },
      }),
    ).rejects.toThrow('Failed to create simple existing topic turn');
  });

  it('createSimpleExistingTopicTurn should persist the thread id on both messages', async () => {
    await seedBase();
    await serverDB.insert(topics).values({
      agentId,
      id: existingTopicId,
      sessionId,
      title: 'Existing Topic',
      userId,
    });
    await serverDB.insert(threads).values({
      id: threadId,
      title: 'Thread',
      topicId: existingTopicId,
      type: 'continuation',
      userId,
    });

    const service = new AiChatService(serverDB, userId);

    const res = await service.createSimpleExistingTopicTurn({
      agentId,
      assistantMessage: { content: 'loading' },
      threadId,
      topicId: existingTopicId,
      userMessage: { content: 'hi' },
    });

    const createdMessages = await getMessagesByTopicId(existingTopicId);

    expect(res.userMessage.threadId).toBe(threadId);
    expect(res.assistantMessage.threadId).toBe(threadId);
    expect(createdMessages).toEqual([
      expect.objectContaining({ id: res.userMessage.id, threadId }),
      expect.objectContaining({ id: res.assistantMessage.id, threadId }),
    ]);
  });

  it('createSimpleExistingTopicTurn should keep group messages detached from session rows', async () => {
    await seedBase();
    await seedGroup();
    await serverDB.insert(topics).values({
      agentId,
      groupId,
      id: existingTopicId,
      sessionId,
      title: 'Existing Topic',
      userId,
    });

    const service = new AiChatService(serverDB, userId);

    const res = await service.createSimpleExistingTopicTurn({
      agentId,
      assistantMessage: { content: 'loading' },
      groupId,
      topicId: existingTopicId,
      userMessage: { content: 'hi' },
    });

    const createdMessages = await getMessagesByTopicId(existingTopicId);

    expect(res.resolvedSessionId).toBe(sessionId);
    expect(res.userMessage.sessionId).toBeNull();
    expect(res.assistantMessage.sessionId).toBeNull();
    expect(createdMessages).toHaveLength(2);
    expect(createdMessages).toEqual([
      expect.objectContaining({ groupId, id: res.userMessage.id, sessionId: null }),
      expect.objectContaining({ groupId, id: res.assistantMessage.id, sessionId: null }),
    ]);
  });

  it('getMessagesAndTopics should fetch messages and topics concurrently', async () => {
    const serverDB = {} as unknown as LobeChatDatabase;

    const mockQueryMessages = vi.fn().mockResolvedValue([{ id: 'm1' }]);
    const mockQueryTopics = vi.fn().mockResolvedValue([{ id: 't1' }]);

    vi.mocked(MessageModel).mockImplementation(() => ({ query: mockQueryMessages }) as any);
    vi.mocked(TopicModel).mockImplementation(() => ({ query: mockQueryTopics }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn().mockResolvedValue('url') }) as any,
    );

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.getMessagesAndTopics({
      agentId: 'agent-1',
      groupId: 'group-1',
      includeTopic: true,
      sessionId: 's1',
      topicPageSize: 20,
    });

    expect(mockQueryMessages).toHaveBeenCalledWith(
      { agentId: 'agent-1', groupId: 'group-1', includeTopic: true, sessionId: 's1' },
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
    expect(mockQueryTopics).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: 'group-1',
      pageSize: 20,
    });
    expect(res.messages).toEqual([{ id: 'm1' }]);
    expect(res.topics).toEqual([{ id: 't1' }]);
  });

  it('getMessagesAndTopics should forward topicFilter to topicModel.query', async () => {
    const serverDB = {} as unknown as LobeChatDatabase;

    const mockQueryMessages = vi.fn().mockResolvedValue([]);
    const mockQueryTopics = vi.fn().mockResolvedValue([]);

    vi.mocked(MessageModel).mockImplementation(() => ({ query: mockQueryMessages }) as any);
    vi.mocked(TopicModel).mockImplementation(() => ({ query: mockQueryTopics }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn().mockResolvedValue('url') }) as any,
    );

    const service = new AiChatService(serverDB, 'u1');

    await service.getMessagesAndTopics({
      agentId: 'agent-1',
      includeTopic: true,
      topicFilter: {
        excludeStatuses: ['completed'],
        excludeTriggers: ['cron', 'eval'],
      },
      topicPageSize: 20,
    });

    expect(mockQueryTopics).toHaveBeenCalledWith({
      agentId: 'agent-1',
      excludeStatuses: ['completed'],
      excludeTriggers: ['cron', 'eval'],
      groupId: undefined,
      pageSize: 20,
    });
    // topicFilter must not leak into messageModel.query
    expect(mockQueryMessages).toHaveBeenCalledWith(
      expect.not.objectContaining({ topicFilter: expect.anything() }),
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
    expect(mockQueryMessages).toHaveBeenCalledWith(
      expect.not.objectContaining({ topicPageSize: 20 }),
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
  });

  it('getMessagesAndTopics should not query topics when includeTopic is false', async () => {
    const serverDB = {} as unknown as LobeChatDatabase;

    const mockQueryMessages = vi.fn().mockResolvedValue([]);
    vi.mocked(MessageModel).mockImplementation(() => ({ query: mockQueryMessages }) as any);
    vi.mocked(TopicModel).mockImplementation(() => ({ query: vi.fn() }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn().mockResolvedValue('url') }) as any,
    );

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.getMessagesAndTopics({ includeTopic: false, topicId: 't1' });

    expect(mockQueryMessages).toHaveBeenCalled();
    expect(res.topics).toBeUndefined();
  });
});
