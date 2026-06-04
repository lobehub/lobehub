import type { LobeChatDatabase } from '@lobechat/database';
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { FileService } from '@/server/services/file';

import { AiChatService } from '.';

vi.mock('@/database/models/message');
vi.mock('@/database/models/topic');
vi.mock('@/server/services/file');

describe('AiChatService', () => {
  const getSqlText = (query: unknown) => {
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];

    return chunks
      .map((chunk) => {
        if (!chunk) return '';

        const value = (chunk as { value?: string[] }).value;

        return Array.isArray(value) ? value.join('') : '';
      })
      .join('');
  };

  const expectGroupSessionNormalization = (query: unknown) => {
    const sqlText = getSqlText(query).replaceAll(/\s+/g, ' ');

    expect(sqlText).toContain('CASE');
    expect(sqlText).toContain(
      '::text IS NOT NULL THEN NULL ELSE "resolved_context"."session_id" END',
    );
  };

  const createPersistedMessage = (overrides: Record<string, unknown> = {}) => ({
    agentId: null,
    clientId: null,
    content: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    error: null,
    favorite: false,
    id: 'm1',
    metadata: null,
    model: null,
    observationId: null,
    parentId: null,
    provider: null,
    quotaId: null,
    reasoning: null,
    role: 'user',
    search: null,
    sessionId: 's1',
    threadId: null,
    tools: null,
    topicId: 't1',
    updatedAt: '2024-01-01T00:00:00.000Z',
    userId: 'u1',
    ...overrides,
  });

  it('createSimpleNewTopicTurn should persist the simple turn with one database call', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          assistantMessage: createPersistedMessage({
            content: 'loading',
            id: 'm-assistant',
            model: 'gpt-4o',
            parentId: 'm-user',
            provider: 'openai',
            role: 'assistant',
          }),
          resolvedSessionId: 's1',
          topicId: 't1',
          userMessage: createPersistedMessage({ content: 'hi', id: 'm-user' }),
        },
      ],
    });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.createSimpleNewTopicTurn({
      agentId: 'agent-1',
      assistantMessage: {
        content: 'loading',
        metadata: {},
        model: 'gpt-4o',
        provider: 'openai',
      },
      sessionId: 's1',
      topic: { title: 'T' },
      userMessage: {
        content: 'hi',
        editorData: { type: 'doc' },
        metadata: {},
      },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(getSqlText(execute.mock.calls[0][0])).toContain('::text IS NOT NULL');
    expect(res.topicId).toBe('t1');
    expect(res.resolvedSessionId).toBe('s1');
    expect(res.userMessage).toEqual(
      expect.objectContaining({
        content: 'hi',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'm-user',
        role: 'user',
      }),
    );
    expect(res.assistantMessage).toEqual(
      expect.objectContaining({
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'm-assistant',
        parentId: 'm-user',
        role: 'assistant',
      }),
    );
  });

  it('createSimpleNewTopicTurn should throw when the database does not return created messages', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    await expect(
      service.createSimpleNewTopicTurn({
        assistantMessage: { content: 'loading' },
        topic: { title: 'T' },
        userMessage: { content: 'hi' },
      }),
    ).rejects.toThrow('Failed to create simple new topic turn');
  });

  it('createSimpleNewTopicTurn should keep group messages detached from session rows', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          assistantMessage: createPersistedMessage({
            groupId: 'group-1',
            id: 'm-assistant',
            parentId: 'm-user',
            role: 'assistant',
            sessionId: null,
          }),
          resolvedSessionId: 's1',
          topicId: 't1',
          userMessage: createPersistedMessage({
            groupId: 'group-1',
            id: 'm-user',
            sessionId: null,
          }),
        },
      ],
    });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.createSimpleNewTopicTurn({
      assistantMessage: { content: 'loading' },
      groupId: 'group-1',
      sessionId: 's1',
      topic: { title: 'T' },
      userMessage: { content: 'hi' },
    });

    expectGroupSessionNormalization(execute.mock.calls[0][0]);
    expect(res.userMessage.sessionId).toBeNull();
    expect(res.assistantMessage.sessionId).toBeNull();
  });

  it('createSimpleExistingTopicTurn should persist the simple turn with one database call', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          assistantMessage: createPersistedMessage({
            content: 'loading',
            id: 'm-assistant',
            model: 'gpt-4o',
            parentId: 'm-user',
            provider: 'openai',
            role: 'assistant',
          }),
          resolvedSessionId: 's1',
          topicId: 't1',
          userMessage: createPersistedMessage({
            content: 'hi',
            id: 'm-user',
            parentId: 'm-parent',
          }),
        },
      ],
    });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.createSimpleExistingTopicTurn({
      agentId: 'agent-1',
      assistantMessage: {
        content: 'loading',
        metadata: {},
        model: 'gpt-4o',
        provider: 'openai',
      },
      sessionId: 's1',
      topicId: 't1',
      userMessage: {
        content: 'hi',
        editorData: { type: 'doc' },
        metadata: {},
        parentId: 'm-parent',
      },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(getSqlText(execute.mock.calls[0][0])).toContain('updated_topic AS');
    expect(getSqlText(execute.mock.calls[0][0])).toContain('SET "updated_at" = NOW()');
    expect(res.topicId).toBe('t1');
    expect(res.resolvedSessionId).toBe('s1');
    expect(res.userMessage).toEqual(
      expect.objectContaining({
        content: 'hi',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'm-user',
        parentId: 'm-parent',
        role: 'user',
      }),
    );
    expect(res.assistantMessage).toEqual(
      expect.objectContaining({
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'm-assistant',
        parentId: 'm-user',
        role: 'assistant',
      }),
    );
  });

  it('createSimpleExistingTopicTurn should throw when the database does not return created messages', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    await expect(
      service.createSimpleExistingTopicTurn({
        assistantMessage: { content: 'loading' },
        topicId: 't1',
        userMessage: { content: 'hi' },
      }),
    ).rejects.toThrow('Failed to create simple existing topic turn');
  });

  it('createSimpleExistingTopicTurn should keep group messages detached from session rows', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          assistantMessage: createPersistedMessage({
            groupId: 'group-1',
            id: 'm-assistant',
            parentId: 'm-user',
            role: 'assistant',
            sessionId: null,
          }),
          resolvedSessionId: 's1',
          topicId: 't1',
          userMessage: createPersistedMessage({
            groupId: 'group-1',
            id: 'm-user',
            sessionId: null,
          }),
        },
      ],
    });
    const serverDB = { execute } as unknown as LobeChatDatabase;

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.createSimpleExistingTopicTurn({
      assistantMessage: { content: 'loading' },
      groupId: 'group-1',
      sessionId: 's1',
      topicId: 't1',
      userMessage: { content: 'hi' },
    });

    expectGroupSessionNormalization(execute.mock.calls[0][0]);
    expect(res.userMessage.sessionId).toBeNull();
    expect(res.assistantMessage.sessionId).toBeNull();
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
