import type { LobeChatDatabase } from '@lobechat/database';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { FileService } from '@/server/services/file';

import { AiChatService } from '.';

vi.mock('@/database/models/message');
vi.mock('@/database/models/topic');
vi.mock('@/server/services/file');

describe('AiChatService', () => {
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

  it('getMessagesAndTopics should use prefetched messages without querying messageModel', async () => {
    const serverDB = {} as unknown as LobeChatDatabase;

    const mockQueryMessages = vi.fn().mockResolvedValue([{ id: 'm-from-query' }]);
    const mockQueryTopics = vi.fn().mockResolvedValue({ items: [{ id: 't1' }], total: 1 });
    const prefetchedMessages = [
      {
        content: 'hi',
        createdAt: 1,
        id: 'm1',
        role: 'user',
        updatedAt: 1,
      },
    ] as UIChatMessage[];

    vi.mocked(MessageModel).mockImplementation(() => ({ query: mockQueryMessages }) as any);
    vi.mocked(TopicModel).mockImplementation(() => ({ query: mockQueryTopics }) as any);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl: vi.fn().mockResolvedValue('url') }) as any,
    );

    const service = new AiChatService(serverDB, 'u1');

    const res = await service.getMessagesAndTopics({
      agentId: 'agent-1',
      includeTopic: true,
      prefetchedMessages,
      topicPageSize: 20,
    });

    expect(mockQueryMessages).not.toHaveBeenCalled();
    expect(mockQueryTopics).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: undefined,
      pageSize: 20,
    });
    expect(res.messages).toBe(prefetchedMessages);
    expect(res.topics).toEqual({ items: [{ id: 't1' }], total: 1 });
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
