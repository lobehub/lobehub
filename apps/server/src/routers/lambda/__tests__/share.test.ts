import type * as BusinessConst from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    assertShareAccess: vi.fn(),
    findBySlugOrId: vi.fn(),
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

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

// The availability gate (cloud-only const + visitor grayscale flag) has its
// own suite (`_helpers/__tests__/agentShareFeatureGate.test.ts`) plus a
// dedicated "visitor capability" block below; elsewhere it is pinned open so
// the read-path behavior under test is reachable.
const mocks = vi.hoisted(() => ({
  businessConst: { ENABLE_BUSINESS_FEATURES: true },
}));
vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');
  return {
    ...actual,
    // `packages/utils/src/apiKey.ts` reads this dynamically (`import * as
    // businessConst`), pulled in transitively via the unmocked
    // `createContextInner` -> `ApiKeyModel` chain below. `actual` here
    // resolves to the cloud override, which omits this key entirely (see
    // that file's own doc comment), so vitest's mock-export validation has
    // no own property to find unless it is listed explicitly.
    API_KEY_PREFIX: (actual as Record<string, unknown>).API_KEY_PREFIX,
    // A getter (not a static spread) so per-test mutation of
    // `mocks.businessConst.ENABLE_BUSINESS_FEATURES` is observed by every
    // subsequent read, including inside the already-imported gate helper.
    get ENABLE_BUSINESS_FEATURES() {
      return mocks.businessConst.ENABLE_BUSINESS_FEATURES;
    },
  };
});

const mockGetFeatureFlagsState = vi.fn();
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: (...args: unknown[]) =>
    mockGetFeatureFlagsState(...args),
}));

const { shareRouter } = await import('../share');

describe('shareRouter', () => {
  describe('getSharedAgent', () => {
    const agentShare = {
      agentAvatar: 'avatar.png',
      agentBackgroundColor: '#ffffff',
      agentDescription: 'A shared agent',
      agentId: 'agent-1',
      agentName: 'Alice',
      agentTitle: 'Research Assistant',
      ownerId: 'owner-user',
      shareConfig: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20, slug: 'shared-agent' },
      shareId: 'agent-share-1',
      userViewCount: 42,
      visibility: 'link',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue(agentShare as any);
      vi.mocked(AgentShareModel.assertShareAccess).mockReturnValue(undefined);
      vi.mocked(AgentShareModel.incrementUserViewCount).mockResolvedValue(undefined);
    });

    it('requires authentication without resolving or counting the share', async () => {
      const caller = shareRouter.createCaller(await createContextInner());

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(AgentShareModel.findBySlugOrId).not.toHaveBeenCalled();
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });

    it('resolves by slug, returns only visitor-safe metadata, and counts the view', async () => {
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      const result = await caller.getSharedAgent({ slugOrId: 'shared-agent' });

      expect(result).toEqual({
        agentId: 'agent-1',
        agentMeta: {
          avatar: 'avatar.png',
          backgroundColor: '#ffffff',
          description: 'A shared agent',
          name: 'Alice',
          title: 'Research Assistant',
        },
        isOwner: false,
        shareId: 'agent-share-1',
        slug: 'shared-agent',
        visibility: 'link',
      });
      expect(result).not.toHaveProperty('ownerId');
      expect(result).not.toHaveProperty('shareConfig');
      expect(result).not.toHaveProperty('userViewCount');
      expect(AgentShareModel.findBySlugOrId).toHaveBeenCalledWith(
        expect.anything(),
        'shared-agent',
      );
      expect(AgentShareModel.assertShareAccess).toHaveBeenCalledWith(agentShare, 'visitor-user');
      expect(AgentShareModel.incrementUserViewCount).toHaveBeenCalledWith(
        expect.anything(),
        'agent-share-1',
      );
    });

    it('does not count owner views', async () => {
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'owner-user' }));

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).resolves.toMatchObject({
        isOwner: true,
      });
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });

    it('resolves by raw share id', async () => {
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      await caller.getSharedAgent({ slugOrId: 'agent-share-1' });

      expect(AgentShareModel.findBySlugOrId).toHaveBeenCalledWith(
        expect.anything(),
        'agent-share-1',
      );
    });

    it('allows the owner to resolve a private share', async () => {
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue({
        ...agentShare,
        visibility: 'private',
      } as any);
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'owner-user' }));

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).resolves.toMatchObject({
        isOwner: true,
        visibility: 'private',
      });
    });

    it('still resolves the share when the view counter fails', async () => {
      vi.mocked(AgentShareModel.incrementUserViewCount).mockRejectedValue(new Error('db down'));
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).resolves.toMatchObject({
        isOwner: false,
        shareId: 'agent-share-1',
      });
    });

    it('returns NOT_FOUND without counting a view when the slug/id does not resolve', async () => {
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue(null);
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      await expect(caller.getSharedAgent({ slugOrId: 'no-such-slug' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });

    it('does not count a failed FORBIDDEN access', async () => {
      const code = 'FORBIDDEN';
      vi.mocked(AgentShareModel.assertShareAccess).mockImplementation(() => {
        throw new TRPCError({ code, message: 'This share is private' });
      });
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).rejects.toMatchObject({
        code,
      });
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
    });

    describe('visitor capability', () => {
      it('rejects on a deployment without business features, even for the owner', async () => {
        mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
        const caller = shareRouter.createCaller(await createContextInner({ userId: 'owner-user' }));

        await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        expect(AgentShareModel.findBySlugOrId).not.toHaveBeenCalled();
      });

      it('rejects a non-owner visitor when the agent share flag is off', async () => {
        mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: false });
        const caller = shareRouter.createCaller(
          await createContextInner({ userId: 'visitor-user' }),
        );

        await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        expect(mockGetFeatureFlagsState).toHaveBeenCalledWith('visitor-user');
        expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
      });

      it('still lets the owner preview their own share when the agent share flag is off', async () => {
        mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: false });
        const caller = shareRouter.createCaller(await createContextInner({ userId: 'owner-user' }));

        await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).resolves.toMatchObject({
          isOwner: true,
        });
        // The owner path never consults the agent share flag at all.
        expect(mockGetFeatureFlagsState).not.toHaveBeenCalled();
      });
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
