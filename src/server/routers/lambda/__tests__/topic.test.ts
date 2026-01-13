import { describe, expect, it, vi } from 'vitest';

import { TopicModel } from '@/database/models/topic';
import { TopicShareModel } from '@/database/models/topicShare';

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));

vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

describe('topicRouter', () => {
  it('should handle createTopic with sessionId', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'topic1' });
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
        }) as any,
    );

    const input = {
      sessionId: 'session1',
      title: 'Test Topic',
    };

    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    const result = await ctx.topicModel.create(input);

    expect(mockCreate).toHaveBeenCalledWith(input);
    expect(result.id).toBe('topic1');
  });

  it('should handle getTopics with groupId', async () => {
    const mockQuery = vi
      .fn()
      .mockResolvedValue({ items: [{ id: 'topic1', title: 'Test' }], total: 1 });
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          query: mockQuery,
        }) as any,
    );

    const input = { groupId: 'group1' };
    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    const result = await ctx.topicModel.query(input);

    expect(mockQuery).toHaveBeenCalledWith(input);
    expect(result).toEqual({ items: [{ id: 'topic1', title: 'Test' }], total: 1 });
  });

  it('should handle deleteTopic', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    await ctx.topicModel.delete('topic1');

    expect(mockDelete).toHaveBeenCalledWith('topic1');
  });

  it('should handle updateTopic', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    const result = await ctx.topicModel.update('topic1', { title: 'Updated Title' });

    expect(mockUpdate).toHaveBeenCalledWith('topic1', { title: 'Updated Title' });
    expect(result).toEqual({ success: true });
  });

  it('should handle batchDelete', async () => {
    const mockBatchDelete = vi.fn().mockResolvedValue({ rowCount: 3 });
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          batchDelete: mockBatchDelete,
        }) as any,
    );

    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    const result = await ctx.topicModel.batchDelete(['topic1', 'topic2', 'topic3']);

    expect(mockBatchDelete).toHaveBeenCalledWith(['topic1', 'topic2', 'topic3']);
    expect(result.rowCount).toBe(3);
  });

  it('should handle countTopics', async () => {
    const mockCount = vi.fn().mockResolvedValue(10);
    vi.mocked(TopicModel).mockImplementation(
      () =>
        ({
          count: mockCount,
        }) as any,
    );

    const ctx = {
      topicModel: new TopicModel({} as any, 'user1'),
    };

    const result = await ctx.topicModel.count();

    expect(mockCount).toHaveBeenCalled();
    expect(result).toBe(10);
  });

  describe('agentId support', () => {
    it('should handle createTopic with agentId', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'topic1' });
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            create: mockCreate,
          }) as any,
      );

      const input = {
        agentId: 'agent1',
        sessionId: 'session1',
        title: 'Test Topic',
      };

      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.create(input);

      expect(mockCreate).toHaveBeenCalledWith(input);
      expect(result.id).toBe('topic1');
    });

    it('should handle getTopics with agentId', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 'topic1', title: 'Test' }]);
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            query: mockQuery,
          }) as any,
      );

      const input = { agentId: 'agent1' };
      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.query(input);

      expect(mockQuery).toHaveBeenCalledWith(input);
      expect(result).toEqual([{ id: 'topic1', title: 'Test' }]);
    });

    it('should handle getTopics with both agentId and sessionId', async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 'topic1', title: 'Test' }]);
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            query: mockQuery,
          }) as any,
      );

      const input = { agentId: 'agent1', sessionId: 'session1' };
      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.query(input);

      expect(mockQuery).toHaveBeenCalledWith(input);
      expect(result).toEqual([{ id: 'topic1', title: 'Test' }]);
    });

    it('should handle batchDeleteByAgentId', async () => {
      const mockBatchDeleteByAgentId = vi.fn().mockResolvedValue({ rowCount: 5 });
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            batchDeleteByAgentId: mockBatchDeleteByAgentId,
          }) as any,
      );

      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.batchDeleteByAgentId('agent1');

      expect(mockBatchDeleteByAgentId).toHaveBeenCalledWith('agent1');
      expect(result.rowCount).toBe(5);
    });

    it('should handle batchCreateTopics with agentId', async () => {
      const mockBatchCreate = vi.fn().mockResolvedValue([{ id: 'topic1' }, { id: 'topic2' }]);
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            batchCreate: mockBatchCreate,
          }) as any,
      );

      const input = [
        { agentId: 'agent1', sessionId: 'session1', title: 'Topic 1' },
        { agentId: 'agent1', sessionId: 'session1', title: 'Topic 2' },
      ];

      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.batchCreate(input as any);

      expect(mockBatchCreate).toHaveBeenCalledWith(input);
      expect(result).toHaveLength(2);
    });

    it('should handle searchTopics with agentId', async () => {
      const mockQueryByKeyword = vi.fn().mockResolvedValue([{ id: 'topic1', title: 'Test' }]);
      vi.mocked(TopicModel).mockImplementation(
        () =>
          ({
            queryByKeyword: mockQueryByKeyword,
          }) as any,
      );

      const ctx = {
        topicModel: new TopicModel({} as any, 'user1'),
      };

      const result = await ctx.topicModel.queryByKeyword('test', 'session1');

      expect(mockQueryByKeyword).toHaveBeenCalledWith('test', 'session1');
      expect(result).toEqual([{ id: 'topic1', title: 'Test' }]);
    });
  });

  describe('topic sharing', () => {
    it('should handle enableSharing with default visibility', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'share-123',
        topicId: 'topic1',
        userId: 'user1',
        visibility: 'private',
      });

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            create: mockCreate,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      const result = await ctx.topicShareModel.create('topic1');

      expect(mockCreate).toHaveBeenCalledWith('topic1');
      expect(result.id).toBe('share-123');
      expect(result.visibility).toBe('private');
    });

    it('should handle enableSharing with link visibility', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'share-456',
        topicId: 'topic1',
        userId: 'user1',
        visibility: 'link',
      });

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            create: mockCreate,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      const result = await ctx.topicShareModel.create('topic1', 'link');

      expect(mockCreate).toHaveBeenCalledWith('topic1', 'link');
      expect(result.visibility).toBe('link');
    });

    it('should handle disableSharing', async () => {
      const mockDeleteByTopicId = vi.fn().mockResolvedValue(undefined);

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            deleteByTopicId: mockDeleteByTopicId,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      await ctx.topicShareModel.deleteByTopicId('topic1');

      expect(mockDeleteByTopicId).toHaveBeenCalledWith('topic1');
    });

    it('should handle updateShareVisibility', async () => {
      const mockUpdateVisibility = vi.fn().mockResolvedValue({
        id: 'share-123',
        topicId: 'topic1',
        visibility: 'link',
      });

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            updateVisibility: mockUpdateVisibility,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      const result = await ctx.topicShareModel.updateVisibility('topic1', 'link');

      expect(mockUpdateVisibility).toHaveBeenCalledWith('topic1', 'link');
      expect(result.visibility).toBe('link');
    });

    it('should handle getShareInfo', async () => {
      const mockGetByTopicId = vi.fn().mockResolvedValue({
        id: 'share-123',
        topicId: 'topic1',
        visibility: 'link',
      });

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            getByTopicId: mockGetByTopicId,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      const result = await ctx.topicShareModel.getByTopicId('topic1');

      expect(mockGetByTopicId).toHaveBeenCalledWith('topic1');
      expect(result).toEqual({
        id: 'share-123',
        topicId: 'topic1',
        visibility: 'link',
      });
    });

    it('should return null when getShareInfo for non-shared topic', async () => {
      const mockGetByTopicId = vi.fn().mockResolvedValue(null);

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            getByTopicId: mockGetByTopicId,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      const result = await ctx.topicShareModel.getByTopicId('non-shared-topic');

      expect(mockGetByTopicId).toHaveBeenCalledWith('non-shared-topic');
      expect(result).toBeNull();
    });

    it('should handle all visibility types', async () => {
      const mockCreate = vi.fn();

      vi.mocked(TopicShareModel).mockImplementation(
        () =>
          ({
            create: mockCreate,
          }) as any,
      );

      const ctx = {
        topicShareModel: new TopicShareModel({} as any, 'user1'),
      };

      // Test private visibility
      mockCreate.mockResolvedValueOnce({ visibility: 'private' });
      await ctx.topicShareModel.create('topic1', 'private');
      expect(mockCreate).toHaveBeenLastCalledWith('topic1', 'private');

      // Test link visibility
      mockCreate.mockResolvedValueOnce({ visibility: 'link' });
      await ctx.topicShareModel.create('topic2', 'link');
      expect(mockCreate).toHaveBeenLastCalledWith('topic2', 'link');
    });
  });
});
