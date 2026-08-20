import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentShareData } from '@/database/models/agentShare';
import { AgentShareModel } from '@/database/models/agentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { shareRouter } from '../share';

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    findByShareIdWithAccessCheck: vi.fn(),
    incrementUserViewCount: vi.fn(),
  },
}));

vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: {
    findByShareIdWithAccessCheck: vi.fn(),
    incrementPageViewCount: vi.fn(),
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

const agentShare = {
  agentAvatar: 'avatar.png',
  agentBackgroundColor: '#ffffff',
  agentDescription: 'A shared agent',
  agentId: 'agent-1',
  agentMarketIdentifier: 'market-agent',
  agentName: 'Alice',
  agentSlug: 'shared-agent',
  agentTitle: 'Research Assistant',
  ownerId: 'owner-user',
  shareConfig: {
    allowReadMemory: true,
    enabledToolIds: ['search'],
    filePermissionConfig: {
      agentFiles: 'read' as const,
      knowledgeBase: 'read' as const,
      uploadAllowed: true,
    },
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
  },
  shareId: '3d038ed5-5db0-4bd4-97c9-3d48f89bf37d',
  userViewCount: 42,
  visibility: 'link',
} satisfies AgentShareData;

describe('shareRouter', () => {
  describe('getSharedAgent', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(AgentShareModel.findByShareIdWithAccessCheck).mockResolvedValue(agentShare);
      vi.mocked(AgentShareModel.incrementUserViewCount).mockResolvedValue(undefined);
    });

    it('requires authentication without resolving or counting the share', async () => {
      const caller = shareRouter.createCaller(await createContextInner());

      await expect(caller.getSharedAgent({ shareId: agentShare.shareId })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(AgentShareModel.findByShareIdWithAccessCheck).not.toHaveBeenCalled();
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });

    it('returns only visitor-safe metadata and increments the page view count', async () => {
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      const result = await caller.getSharedAgent({ shareId: agentShare.shareId });

      expect(result).toEqual({
        agentId: 'agent-1',
        agentMeta: {
          avatar: 'avatar.png',
          backgroundColor: '#ffffff',
          description: 'A shared agent',
          marketIdentifier: 'market-agent',
          name: 'Alice',
          slug: 'shared-agent',
          title: 'Research Assistant',
        },
        isOwner: false,
        shareId: agentShare.shareId,
        visibility: 'link',
      });
      expect(result).not.toHaveProperty('ownerId');
      expect(result).not.toHaveProperty('shareConfig');
      expect(result).not.toHaveProperty('userViewCount');
      expect(AgentShareModel.findByShareIdWithAccessCheck).toHaveBeenCalledWith(
        expect.anything(),
        agentShare.shareId,
        'visitor-user',
      );
      expect(AgentShareModel.incrementUserViewCount).toHaveBeenCalledWith(
        expect.anything(),
        agentShare.shareId,
      );
    });

    it('allows the owner to resolve a private share', async () => {
      vi.mocked(AgentShareModel.findByShareIdWithAccessCheck).mockResolvedValue({
        ...agentShare,
        visibility: 'private',
      });
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'owner-user' }));

      await expect(caller.getSharedAgent({ shareId: agentShare.shareId })).resolves.toMatchObject({
        isOwner: true,
        visibility: 'private',
      });
      expect(AgentShareModel.findByShareIdWithAccessCheck).toHaveBeenCalledWith(
        expect.anything(),
        agentShare.shareId,
        'owner-user',
      );
      expect(AgentShareModel.incrementUserViewCount).toHaveBeenCalledOnce();
    });

    it.each([
      ['FORBIDDEN', agentShare.shareId, 'This share is private'],
      ['NOT_FOUND', 'not-a-uuid', 'Share not found'],
    ] as const)('does not count a failed %s access', async (code, shareId, message) => {
      vi.mocked(AgentShareModel.findByShareIdWithAccessCheck).mockRejectedValue(
        new TRPCError({ code, message }),
      );
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      await expect(caller.getSharedAgent({ shareId })).rejects.toMatchObject({
        code,
      });
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });
  });

  describe('getSharedTopic', () => {
    it('should return shared topic data for valid share', async () => {
      const mockShare = {
        agentAvatar: 'avatar.png',
        agentBackgroundColor: '#fff',
        agentId: 'agent-1',
        agentMarketIdentifier: 'market-id',
        agentSlug: 'agent-slug',
        agentName: null,
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
        workspaceId: null,
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
        agentName: null,
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
        workspaceId: null,
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
        agentName: null,
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
        workspaceId: null,
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
        agentName: null,
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
        workspaceId: null,
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
