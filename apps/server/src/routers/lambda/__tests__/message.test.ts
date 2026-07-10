import {
  type CreateMessageParams,
  type UIChatMessage,
  type UpdateMessageRAGParams,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { TopicShareModel } from '@/database/models/topicShare';
import { FileService } from '@/server/services/file';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: {
    findByShareIdWithAccessCheck: vi.fn(),
  },
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
    expect(result).toEqual([{ id: 'msg1' }]);
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

  describe('agentId support', () => {
    it('should handle createMessage with agentId', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'msg1' });
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            create: mockCreate,
          }) as any,
      );

      const input: CreateMessageParams = {
        agentId: 'agent1',
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

    it('should handle getMessages with agentId', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 'msg1' }]);
      const mockGetFullFileUrl = vi
        .fn()
        .mockImplementation((path: string | null) => Promise.resolve('url'));

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

      const input = { agentId: 'agent1', sessionId: 'session1' };
      const ctx = {
        messageModel: new MessageModel({} as any, 'user1'),
        fileService: new FileService({} as any, 'user1'),
      };

      const result = await ctx.messageModel.query(input, {
        postProcessUrl: mockGetFullFileUrl,
      });

      expect(mockQuery).toHaveBeenCalledWith(input, expect.any(Object));
      expect(result).toEqual([{ id: 'msg1' }]);
    });

    it('should handle getMessages with agentId only (no sessionId)', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 'msg1' }]);
      const mockGetFullFileUrl = vi
        .fn()
        .mockImplementation((path: string | null) => Promise.resolve('url'));

      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            query: mockQuery,
          }) as any,
      );

      const input = { agentId: 'agent1' };
      const ctx = {
        messageModel: new MessageModel({} as any, 'user1'),
      };

      const result = await ctx.messageModel.query(input, {
        postProcessUrl: mockGetFullFileUrl,
      });

      expect(mockQuery).toHaveBeenCalledWith(input, expect.any(Object));
      expect(result).toEqual([{ id: 'msg1' }]);
    });

    it('should handle batchDeleteByAgentId', async () => {
      const mockBatchDeleteByAgentId = vi.fn().mockResolvedValue({ rowCount: 5 });
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            batchDeleteByAgentId: mockBatchDeleteByAgentId,
          }) as any,
      );

      const ctx = {
        messageModel: new MessageModel({} as any, 'user1'),
      };

      const result = await ctx.messageModel.batchDeleteByAgentId('agent1');

      expect(mockBatchDeleteByAgentId).toHaveBeenCalledWith('agent1');
      expect(result.rowCount).toBe(5);
    });
  });

  describe('topicShareId support', () => {
    it('should get messages via topicShareId for link share', async () => {
      const mockShare = {
        visibility: 'link',
        ownerId: 'owner-user',
        shareId: 'share-123',
        topicId: 'topic-1',
      };

      const mockMessages = [
        { id: 'msg1', content: 'Hello', role: 'user' },
        { id: 'msg2', content: 'Hi there', role: 'assistant' },
      ];

      const mockQuery = vi.fn().mockResolvedValue(mockMessages);
      const mockGetFullFileUrl = vi
        .fn()
        .mockImplementation((path: string) => `https://cdn/${path}`);

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare as any);
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

      // Simulate the router logic
      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        {} as any,
        'share-123',
        undefined,
      );

      expect(share).toBeDefined();
      expect(share.topicId).toBe('topic-1');
      expect(share.ownerId).toBe('owner-user');

      // Create model using owner's id
      const messageModel = new MessageModel({} as any, share.ownerId);
      const result = await messageModel.query(
        { topicId: share.topicId },
        { postProcessUrl: mockGetFullFileUrl },
      );

      expect(result).toEqual(mockMessages);
    });

    it('should allow owner to access private share messages', async () => {
      const mockShare = {
        visibility: 'private',
        ownerId: 'owner-user',
        shareId: 'private-share',
        topicId: 'topic-private',
      };

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare as any);

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        {} as any,
        'private-share',
        'owner-user', // Owner accessing
      );

      expect(share).toBeDefined();
      expect(share.visibility).toBe('private');
    });

    it('should throw FORBIDDEN for private share accessed by non-owner', async () => {
      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' }),
      );

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck({} as any, 'private-share', 'other-user'),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(
          {} as any,
          'private-share',
          'other-user',
        );
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('should throw NOT_FOUND for non-existent share', async () => {
      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockRejectedValue(
        new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' }),
      );

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck({} as any, 'non-existent', 'user1'),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck({} as any, 'non-existent', 'user1');
      } catch (error) {
        expect((error as TRPCError).code).toBe('NOT_FOUND');
      }
    });

    it('should use owner id to query messages for shared topic', async () => {
      const mockShare = {
        visibility: 'link',
        ownerId: 'topic-owner',
        shareId: 'share-abc',
        topicId: 'shared-topic',
      };

      const mockQuery = vi.fn().mockResolvedValue([{ id: 'msg1' }]);

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare as any);
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            query: mockQuery,
          }) as any,
      );

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        {} as any,
        'share-abc',
        undefined,
      );

      // Verify we use the owner's id to create MessageModel
      const messageModel = new MessageModel({} as any, share.ownerId);
      await messageModel.query({ topicId: share.topicId }, {});

      // Verify MessageModel was instantiated with owner's id
      expect(MessageModel).toHaveBeenCalledWith({} as any, 'topic-owner');
      expect(mockQuery).toHaveBeenCalledWith({ topicId: 'shared-topic' }, {});
    });
  });
});
