// @vitest-environment node
import { ThreadType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { AiChatService } from '@/server/services/aiChat';

import { aiChatRouter } from '../aiChat';

vi.mock('@/database/models/agent');
vi.mock('@/database/models/message');
vi.mock('@/database/models/thread');
vi.mock('@/database/models/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('aiChatRouter', () => {
  const mockCtx = { userId: 'u1' };

  it('should create topic optionally, create user/assistant messages, and return payload', async () => {
    const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({
      messages: [{ id: 'm-user' }, { id: 'm-assistant' }],
      topics: { items: [{}], total: 1 },
    });

    vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const input = {
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newTopic: { title: 'T', topicMessageIds: ['a', 'b'] },
      newUserMessage: { content: 'hi', files: ['f1'] },
      sessionId: 's1',
    } as any;

    const res = await caller.sendMessageInServer(input);

    expect(mockCreateTopic).toHaveBeenCalledWith({
      messages: ['a', 'b'],
      sessionId: 's1',
      title: 'T',
    });

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'hi',
        files: ['f1'],
        role: 'user',
        sessionId: 's1',
        topicId: 't1',
      }),
    );

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: expect.any(String),
        model: 'gpt-4o',
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        topicId: 't1',
      }),
    );

    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ includeTopic: true, sessionId: 's1', topicId: 't1' }),
    );
    expect(res.assistantMessageId).toBe('m-assistant');
    expect(res.userMessageId).toBe('m-user');
    expect(res.isCreateNewTopic).toBe(true);
    expect(res.topicId).toBe('t1');
    expect(res.messages?.length).toBe(2);
    expect(res.topics?.items.length).toBe(1);
    expect(res.topics?.total).toBe(1);
  });

  it('should reuse existing topic when topicId provided', async () => {
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't-exist',
    } as any);

    expect(mockCreateMessage).toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTopic: false,
        sessionId: 's1',
        topicId: 't-exist',
      }),
    );
    expect(res.isCreateNewTopic).toBe(false);
    expect(res.topicId).toBe('t-exist');
  });

  it('should pass threadId to both user and assistant messages when provided', async () => {
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      threadId: 'thread-123',
      topicId: 't1',
    } as any);

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'hi',
        role: 'user',
        sessionId: 's1',
        threadId: 'thread-123',
        topicId: 't1',
      }),
    );

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        threadId: 'thread-123',
        topicId: 't1',
      }),
    );
  });

  it('should create thread and use its id for messages when newThread is provided', async () => {
    const mockCreateThread = vi.fn().mockResolvedValue({ id: 'thread-new' });
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(ThreadModel).mockImplementation(() => ({ create: mockCreateThread }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newThread: {
        sourceMessageId: 'source-msg-123',
        title: 'Thread Title',
        type: ThreadType.Standalone,
      },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't1',
    } as any);

    // Verify thread was created with correct params
    expect(mockCreateThread).toHaveBeenCalledWith({
      parentThreadId: undefined,
      sourceMessageId: 'source-msg-123',
      title: 'Thread Title',
      topicId: 't1',
      type: ThreadType.Standalone,
    });

    // Verify messages use the newly created threadId
    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'hi',
        role: 'user',
        sessionId: 's1',
        threadId: 'thread-new',
        topicId: 't1',
      }),
    );

    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentId: 'm-user',
        role: 'assistant',
        sessionId: 's1',
        threadId: 'thread-new',
        topicId: 't1',
      }),
    );

    // Verify response includes createdThreadId
    expect(res.createdThreadId).toBe('thread-new');
  });

  it('should create both topic and thread in same request', async () => {
    const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't-new' });
    const mockCreateThread = vi.fn().mockResolvedValue({ id: 'thread-new' });
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{ id: 't-new' }] });

    vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
    vi.mocked(ThreadModel).mockImplementation(() => ({ create: mockCreateThread }) as any);
    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newThread: {
        sourceMessageId: 'source-msg-123',
        type: ThreadType.Continuation,
      },
      newTopic: { title: 'New Topic' },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
    } as any);

    // Topic created first
    expect(mockCreateTopic).toHaveBeenCalledWith({
      messages: undefined,
      sessionId: 's1',
      title: 'New Topic',
    });

    // Thread created with newly created topicId
    expect(mockCreateThread).toHaveBeenCalledWith({
      parentThreadId: undefined,
      sourceMessageId: 'source-msg-123',
      title: undefined,
      topicId: 't-new',
      type: ThreadType.Continuation,
    });

    // Messages use both new topicId and threadId
    expect(mockCreateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'hi',
        role: 'user',
        sessionId: 's1',
        threadId: 'thread-new',
        topicId: 't-new',
      }),
    );

    expect(res.isCreateNewTopic).toBe(true);
    expect(res.topicId).toBe('t-new');
    expect(res.createdThreadId).toBe('thread-new');
  });

  it('should not set createdThreadId when newThread is not provided', async () => {
    const mockCreateMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: 'm-user' })
      .mockResolvedValueOnce({ id: 'm-assistant' });
    const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

    vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
    vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

    const caller = aiChatRouter.createCaller(mockCtx as any);

    const res = await caller.sendMessageInServer({
      newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
      newUserMessage: { content: 'hi' },
      sessionId: 's1',
      topicId: 't1',
    } as any);

    expect(res.createdThreadId).toBeUndefined();
  });

  describe('groupId support', () => {
    it('should pass groupId to topic creation when both newTopic and groupId exist', async () => {
      const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{}] });

      vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        groupId: 'group-123',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newTopic: { title: 'New Topic' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
      } as any);

      // Verify groupId is passed to topic creation
      expect(mockCreateTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-123',
          sessionId: 's1',
          title: 'New Topic',
        }),
      );
    });

    it('should set groupId to null when newTopic exists but groupId is not provided', async () => {
      const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{}] });

      vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        // no groupId provided
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newTopic: { title: 'New Topic' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
      } as any);

      // Verify groupId is undefined (which will be treated as null in the database)
      expect(mockCreateTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: undefined,
          sessionId: 's1',
          title: 'New Topic',
        }),
      );
    });

    it('should pass groupId to both user and assistant message creation', async () => {
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'supervisor-agent',
        groupId: 'group-123',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'Analyze weather data' },
        sessionId: 's1',
        topicId: 't1',
      } as any);

      // Verify groupId is passed to user message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'supervisor-agent',
          content: 'Analyze weather data',
          groupId: 'group-123',
          role: 'user',
          sessionId: 's1',
          topicId: 't1',
        }),
      );

      // Verify groupId is passed to assistant message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          agentId: 'supervisor-agent',
          groupId: 'group-123',
          parentId: 'm-user',
          role: 'assistant',
          sessionId: 's1',
          topicId: 't1',
        }),
      );
    });

    it('should pass groupId to getMessagesAndTopics for querying', async () => {
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'supervisor-agent',
        groupId: 'group-123',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
        topicId: 't1',
      } as any);

      // Verify groupId is passed to getMessagesAndTopics
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'supervisor-agent',
          groupId: 'group-123',
          sessionId: 's1',
          topicId: 't1',
        }),
      );
    });

    it('should not set groupId when not provided (normal single-agent chat)', async () => {
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'agent-1',
        // no groupId - normal single-agent chat
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
        topicId: 't1',
      } as any);

      // Verify groupId is undefined in user message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'agent-1',
          groupId: undefined,
          role: 'user',
        }),
      );

      // Verify groupId is undefined in assistant message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          agentId: 'agent-1',
          groupId: undefined,
          role: 'assistant',
        }),
      );

      // Verify groupId is undefined in getMessagesAndTopics
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          groupId: undefined,
        }),
      );
    });
  });

  describe('agentId support', () => {
    it('should pass agentId to messages when provided', async () => {
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });

      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'agent-1',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
        topicId: 't1',
      } as any);

      // Verify agentId is passed to user message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'agent-1',
          content: 'hi',
          role: 'user',
          sessionId: 's1',
          topicId: 't1',
        }),
      );

      // Verify agentId is passed to assistant message
      expect(mockCreateMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          agentId: 'agent-1',
          role: 'assistant',
          sessionId: 's1',
          topicId: 't1',
        }),
      );

      // Verify agentId is passed to getMessagesAndTopics
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 's1',
          topicId: 't1',
        }),
      );
    });

    it('should pass agentId to topic creation when provided', async () => {
      const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{}] });
      const mockTouchUpdatedAt = vi.fn().mockResolvedValue(undefined);

      vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);
      vi.mocked(AgentModel).mockImplementation(
        () => ({ touchUpdatedAt: mockTouchUpdatedAt }) as any,
      );

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'agent-1',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newTopic: { title: 'New Topic' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
      } as any);

      // Verify agentId is passed to topic creation
      expect(mockCreateTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 's1',
          title: 'New Topic',
        }),
      );
    });

    it('should touch agent updatedAt when creating new topic with agentId', async () => {
      const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{}] });
      const mockTouchUpdatedAt = vi.fn().mockResolvedValue(undefined);

      vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);
      vi.mocked(AgentModel).mockImplementation(
        () => ({ touchUpdatedAt: mockTouchUpdatedAt }) as any,
      );

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'agent-1',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newTopic: { title: 'New Topic' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
      } as any);

      // Verify touchUpdatedAt was called with the agentId
      expect(mockTouchUpdatedAt).toHaveBeenCalledWith('agent-1');
    });

    it('should not touch agent updatedAt when creating topic without agentId', async () => {
      const mockCreateTopic = vi.fn().mockResolvedValue({ id: 't1' });
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: [{}] });
      const mockTouchUpdatedAt = vi.fn().mockResolvedValue(undefined);

      vi.mocked(TopicModel).mockImplementation(() => ({ create: mockCreateTopic }) as any);
      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);
      vi.mocked(AgentModel).mockImplementation(
        () => ({ touchUpdatedAt: mockTouchUpdatedAt }) as any,
      );

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        // no agentId provided
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newTopic: { title: 'New Topic' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
      } as any);

      // Verify touchUpdatedAt was NOT called
      expect(mockTouchUpdatedAt).not.toHaveBeenCalled();
    });

    it('should not touch agent updatedAt when using existing topic', async () => {
      const mockCreateMessage = vi
        .fn()
        .mockResolvedValueOnce({ id: 'm-user' })
        .mockResolvedValueOnce({ id: 'm-assistant' });
      const mockGet = vi.fn().mockResolvedValue({ messages: [], topics: undefined });
      const mockTouchUpdatedAt = vi.fn().mockResolvedValue(undefined);

      vi.mocked(MessageModel).mockImplementation(() => ({ create: mockCreateMessage }) as any);
      vi.mocked(AiChatService).mockImplementation(() => ({ getMessagesAndTopics: mockGet }) as any);
      vi.mocked(AgentModel).mockImplementation(
        () => ({ touchUpdatedAt: mockTouchUpdatedAt }) as any,
      );

      const caller = aiChatRouter.createCaller(mockCtx as any);

      await caller.sendMessageInServer({
        agentId: 'agent-1',
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'hi' },
        sessionId: 's1',
        topicId: 't-exist', // existing topic, no newTopic
      } as any);

      // Verify touchUpdatedAt was NOT called since no new topic was created
      expect(mockTouchUpdatedAt).not.toHaveBeenCalled();
    });
  });

  describe('outputJSON', () => {
    it('should successfully generate structured output', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');

      const mockResult = { object: { name: 'John', age: 30 } };
      const mockGenerateObject = vi.fn().mockResolvedValue(mockResult);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
        generateObject: mockGenerateObject,
      } as any);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      const input = {
        messages: [{ content: 'test', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
        schema: {
          name: 'Person',
          schema: {
            type: 'object' as const,
            properties: { name: { type: 'string' }, age: { type: 'number' } },
          },
        },
      };

      const result = await caller.outputJSON(input);

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith({}, 'u1', 'openai');
      expect(mockGenerateObject).toHaveBeenCalledWith({
        messages: input.messages,
        model: 'gpt-4o',
        schema: input.schema,
        tools: undefined,
      });
      expect(result).toEqual(mockResult);
    });

    it('should handle tools parameter when provided', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');

      const mockTools = [
        {
          type: 'function' as const,
          function: {
            name: 'test',
            parameters: {
              type: 'object' as const,
              properties: { input: { type: 'string' } },
            },
          },
        },
      ];
      const mockGenerateObject = vi.fn().mockResolvedValue({ object: {} });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
        generateObject: mockGenerateObject,
      } as any);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      const input = {
        messages: [],
        model: 'gpt-4o',
        provider: 'openai',
        tools: mockTools,
      };

      await caller.outputJSON(input);

      expect(mockGenerateObject).toHaveBeenCalledWith({
        messages: [],
        model: 'gpt-4o',
        schema: undefined,
        tools: mockTools,
      });
    });
  });
});
