import { CreateMessageParams, UIChatMessage, UpdateMessageRAGParams } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { FileService } from '@/server/services/file';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

describe('messageRouter', () => {
  it('should handle batchCreateMessages', async () => {
    const mockBatchCreate = vi.fn().mockResolvedValue({ rowCount: 2 });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          batchCreate: mockBatchCreate,
        }) as any,
    );

    const input = [
      {
        id: '1',
        role: 'user',
        content: 'test',
        sessionId: 'session1',
        createdAt: new Date(),
        updatedAt: new Date(),
        agentId: 'agent1',
        clientId: 'client1',
        parentId: null,
        quotaId: null,
        model: null,
        provider: null,
        topicId: null,
        error: null,
        favorite: false,
        observationId: null,
        reasoning: null,
        pluginState: null,
        translate: null,
        tts: null,
        search: null,
        threadId: null,
        tools: null,
        traceId: null,
        userId: 'user1',
      } as any,
    ];

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.batchCreate(input);

    expect(mockBatchCreate).toHaveBeenCalledWith(input);
    expect(result.rowCount).toBe(2);
  });

  it('should handle count', async () => {
    const mockCount = vi.fn().mockResolvedValue(5);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          count: mockCount,
        }) as any,
    );

    const input = { startDate: '2024-01-01' };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.count(input);

    expect(mockCount).toHaveBeenCalledWith(input);
    expect(result).toBe(5);
  });

  it('should handle createMessage', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'msg1' });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
        }) as any,
    );

    const input: CreateMessageParams = {
      content: 'test',
      role: 'user',
      sessionId: 'session1',
    };

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.create(input);

    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(result.id).toBe('msg1');
  });

  it('should handle getMessages', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 'msg1' }]);
    const mockGetFullFileUrl = vi
      .fn()
      .mockImplementation((path: string | null, file: { fileType: string }) => {
        return Promise.resolve('url');
      });

    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          query: mockQuery,
        }) as any,
    );

    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          getFullFileUrl: mockGetFullFileUrl,
        }) as any,
    );

    const input = { sessionId: 'session1' };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
      fileService: new FileService({} as any, 'user1'),
      userId: 'user1',
    };

    const result = await ctx.messageModel.query(input, {
      postProcessUrl: mockGetFullFileUrl,
    });

    expect(mockQuery).toHaveBeenCalledWith(input, expect.any(Object));
    expect(result).toEqual([{ id: 'msg1' }]);
  });

  it('should handle getAllMessages', async () => {
    const mockQueryAll = vi.fn().mockResolvedValue([
      {
        id: 'msg1',
        meta: {},
      } as UIChatMessage,
    ]);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          queryAll: mockQueryAll,
        }) as any,
    );

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.queryAll();

    expect(mockQueryAll).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'msg1', meta: {} }]);
  });

  it('should handle removeMessage', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          deleteMessage: mockDelete,
        }) as any,
    );

    const input = { id: 'msg1' };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    await ctx.messageModel.deleteMessage(input.id);

    expect(mockDelete).toHaveBeenCalledWith(input.id);
  });

  it('should handle updateMessage', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const input = { id: 'msg1', value: { content: 'updated' } };
    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    const result = await ctx.messageModel.update(input.id, input.value);

    expect(mockUpdate).toHaveBeenCalledWith(input.id, input.value);
    expect(result).toEqual({ success: true });
  });

  it('should handle updateMessageRAG', async () => {
    const mockUpdateRAG = vi.fn().mockResolvedValue(undefined);
    vi.mocked(MessageModel).mockImplementation(
      () =>
        ({
          updateMessageRAG: mockUpdateRAG,
        }) as any,
    );

    const input = {
      id: 'msg1',
      value: { ragQueryId: 'q1', fileChunks: [{ id: 'c1', similarity: 0.9 }] },
    } as {
      id: string;
      value: UpdateMessageRAGParams;
    };

    const ctx = {
      messageModel: new MessageModel({} as any, 'user1'),
    };

    await ctx.messageModel.updateMessageRAG(input.id, input.value);

    expect(mockUpdateRAG).toHaveBeenCalledWith('msg1', {
      ragQueryId: 'q1',
      fileChunks: [{ id: 'c1', similarity: 0.9 }],
    });
  });
});
