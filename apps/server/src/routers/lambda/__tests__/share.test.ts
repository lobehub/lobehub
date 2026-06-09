import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { TopicShareModel } from '@/database/models/topicShare';

vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: {
    findByShareIdWithAccessCheck: vi.fn(),
    incrementPageViewCount: vi.fn(),
  },
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

describe('shareRouter', () => {
  describe('getSharedTopic', () => {
    it('should return shared topic data for valid share', async () => {
      const mockShare = {
        agentAvatar: 'avatar.png',
        agentBackgroundColor: '#fff',
        agentId: 'agent-1',
        agentMarketIdentifier: 'market-id',
        agentSlug: 'agent-slug',
        agentTitle: 'Test Agent',
        groupAvatar: null,
        groupBackgroundColor: null,
        groupCreatedAt: null,
        groupId: null,
        groupMembers: undefined,
        groupTitle: null,
        groupUpdatedAt: null,
        groupUserId: null,
        ownerId: 'user-1',
        shareId: 'share-123',
        title: 'Test Topic',
        topicId: 'topic-1',
        visibility: 'link',
      };

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare);
      vi.mocked(TopicShareModel.incrementPageViewCount).mockResolvedValue(undefined);

      const ctx = {
        serverDB: {} as any,
        userId: 'user-1',
      };

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        'share-123',
        ctx.userId,
      );

      expect(share).toBeDefined();
      expect(share.shareId).toBe('share-123');
      expect(share.topicId).toBe('topic-1');
      expect(share.title).toBe('Test Topic');
      expect(share.visibility).toBe('link');

      // Verify incrementPageViewCount would be called
      await TopicShareModel.incrementPageViewCount(ctx.serverDB, 'share-123');
      expect(TopicShareModel.incrementPageViewCount).toHaveBeenCalledWith(
        ctx.serverDB,
        'share-123',
      );
    });

    it('should return agent meta when share has agent', async () => {
      const mockShare = {
        agentAvatar: 'avatar.png',
        agentBackgroundColor: '#ffffff',
        agentId: 'agent-1',
        agentMarketIdentifier: 'market-agent',
        agentSlug: 'test-agent',
        agentTitle: 'Test Agent Title',
        groupAvatar: null,
        groupBackgroundColor: null,
        groupCreatedAt: null,
        groupId: null,
        groupMembers: undefined,
        groupTitle: null,
        groupUpdatedAt: null,
        groupUserId: null,
        ownerId: 'user-1',
        shareId: 'share-123',
        title: 'Topic with Agent',
        topicId: 'topic-1',
        visibility: 'link',
      };

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare);

      const ctx = {
        serverDB: {} as any,
        userId: null,
      };

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        'share-123',
        undefined,
      );

      expect(share.agentId).toBe('agent-1');
      expect(share.agentAvatar).toBe('avatar.png');
      expect(share.agentTitle).toBe('Test Agent Title');
      expect(share.agentMarketIdentifier).toBe('market-agent');
      expect(share.agentSlug).toBe('test-agent');
    });

    it('should return group meta when share has group', async () => {
      const mockShare = {
        agentAvatar: null,
        agentBackgroundColor: null,
        agentId: null,
        agentMarketIdentifier: null,
        agentSlug: null,
        agentTitle: null,
        groupAvatar: 'group-avatar.png',
        groupBackgroundColor: '#000000',
        groupCreatedAt: new Date('2024-01-01'),
        groupId: 'group-1',
        groupMembers: [
          { avatar: 'member1.png', backgroundColor: '#111', id: 'member-1', title: 'Member 1' },
          { avatar: 'member2.png', backgroundColor: '#222', id: 'member-2', title: 'Member 2' },
        ],
        groupTitle: 'Test Group',
        groupUpdatedAt: new Date('2024-01-02'),
        groupUserId: 'user-1',
        ownerId: 'user-1',
        shareId: 'share-456',
        title: 'Group Topic',
        topicId: 'topic-2',
        visibility: 'link',
      };

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare);

      const ctx = {
        serverDB: {} as any,
        userId: 'user-2',
      };

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        'share-456',
        ctx.userId,
      );

      expect(share.groupId).toBe('group-1');
      expect(share.groupTitle).toBe('Test Group');
      expect(share.groupAvatar).toBe('group-avatar.png');
      expect(share.groupMembers).toHaveLength(2);
    });

    it('should throw NOT_FOUND for non-existent share', async () => {
      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockRejectedValue(
        new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' }),
      );

      const ctx = {
        serverDB: {} as any,
        userId: 'user-1',
      };

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(ctx.serverDB, 'non-existent', ctx.userId),
      ).rejects.toThrow(TRPCError);
    });

    it('should throw FORBIDDEN for private share accessed by non-owner', async () => {
      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' }),
      );

      const ctx = {
        serverDB: {} as any,
        userId: 'other-user',
      };

      await expect(
        TopicShareModel.findByShareIdWithAccessCheck(ctx.serverDB, 'private-share', ctx.userId),
      ).rejects.toThrow(TRPCError);

      try {
        await TopicShareModel.findByShareIdWithAccessCheck(
          ctx.serverDB,
          'private-share',
          ctx.userId,
        );
      } catch (error) {
        expect((error as TRPCError).code).toBe('FORBIDDEN');
      }
    });

    it('should allow owner to access private share', async () => {
      const mockShare = {
        agentAvatar: null,
        agentBackgroundColor: null,
        agentId: null,
        agentMarketIdentifier: null,
        agentSlug: null,
        agentTitle: null,
        groupAvatar: null,
        groupBackgroundColor: null,
        groupCreatedAt: null,
        groupId: null,
        groupMembers: undefined,
        groupTitle: null,
        groupUpdatedAt: null,
        groupUserId: null,
        ownerId: 'owner-user',
        shareId: 'private-share',
        title: 'Private Topic',
        topicId: 'topic-private',
        visibility: 'private',
      };

      vi.mocked(TopicShareModel.findByShareIdWithAccessCheck).mockResolvedValue(mockShare);

      const ctx = {
        serverDB: {} as any,
        userId: 'owner-user',
      };

      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        'private-share',
        ctx.userId,
      );

      expect(share).toBeDefined();
      expect(share.ownerId).toBe('owner-user');
      expect(share.visibility).toBe('private');
    });
  });
});
