import type * as BusinessConst from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentShareModel } from '@/database/models/agentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/server/services/agentShare/deliveryStatsCache', () => ({
  getCachedDeliveryStats: (_db: unknown, _owner: string, _agent: string, load: () => unknown) =>
    load(),
}));

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: {
    assertShareAccess: vi.fn(),
    findBySlugOrId: vi.fn(),
    incrementUserViewCount: vi.fn(),
  },
}));

const countShareVisitors = vi.fn();
const topicModelConstructor = vi.fn();
const profileModelConstructor = vi.fn();
const listFeaturedWorks = vi.fn();
const getDeliveryStats = vi.fn();
const emptyDeliveryStats = {
  averageOperationDurationSeconds: null,
  averageWorkCost: null,
  lastDeliveredAt: null,
  workCount: 0,
};

vi.mock('@/database/models/agentShareProfile', () => ({
  AgentShareProfileModel: class {
    constructor(...args: unknown[]) {
      profileModelConstructor(...args);
    }
    getStats = getDeliveryStats;
    listFeaturedWorks = listFeaturedWorks;
  },
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    constructor(...args: unknown[]) {
      topicModelConstructor(...args);
    }
    countShareVisitors = countShareVisitors;
  },
}));

const loadModelsMock = vi.hoisted(() => vi.fn());
const findByIdAndProviderMock = vi.hoisted(() => vi.fn());
const aiModelModelConstructor = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: loadModelsMock,
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    constructor(...args: unknown[]) {
      aiModelModelConstructor(...args);
    }
    findByIdAndProvider = findByIdAndProviderMock;
  },
}));

const resolveModelSelectionMock = vi.hoisted(() => vi.fn());
const agentServiceConstructor = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    constructor(...args: unknown[]) {
      agentServiceConstructor(...args);
    }
    resolveModelSelection = resolveModelSelectionMock;
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
      agentModel: 'gpt-4o',
      agentName: 'Alice',
      agentOpeningQuestions: ['What can you do?'],
      agentProvider: 'openai',
      agentTags: ['research'],
      agentTitle: 'Research Assistant',
      ownerId: 'owner-user',
      ownerAvatar: 'owner.png',
      ownerFullName: 'Owner Person',
      ownerUsername: 'owner',
      shareConfig: {
        maxTopicsPerVisitor: 5,
        maxTurnsPerTopic: 20,
        slug: 'shared-agent',
        toolGrants: [{ apis: ['search'], identifier: 'lobe-web-browsing' }],
      },
      shareId: 'agent-share-1',
      userViewCount: 42,
      visibility: 'link',
      workspaceId: null,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue(agentShare as any);
      vi.mocked(AgentShareModel.assertShareAccess).mockReturnValue(undefined);
      vi.mocked(AgentShareModel.incrementUserViewCount).mockResolvedValue(undefined);
      countShareVisitors.mockResolvedValue({ topicCount: 12, visitorCount: 7 });
      listFeaturedWorks.mockResolvedValue([]);
      getDeliveryStats.mockResolvedValue(emptyDeliveryStats);
      loadModelsMock.mockResolvedValue([
        {
          abilities: { audio: false, video: false, vision: true },
          id: 'gpt-4o',
          providerId: 'openai',
        },
      ]);
      findByIdAndProviderMock.mockResolvedValue(undefined);
      resolveModelSelectionMock.mockResolvedValue({ model: 'gpt-4o', provider: 'openai' });
    });

    it('returns independent demos and selected deliveries in the owner scope', async () => {
      const demoCases = [{ prompt: 'Review this migration', description: 'Find deployment risks' }];
      const work = { id: 'work-selected', title: 'Migration review', totalCost: 0.2 };
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue({
        ...agentShare,
        shareConfig: {
          ...agentShare.shareConfig,
          demoCases,
          featuredWorkIds: [work.id],
          maxFileStorage: 512 * 1024 * 1024,
          monthlySpendLimit: 10,
        },
        agentSlug: 'agent-profile',
      });
      listFeaturedWorks.mockResolvedValue([work]);
      getDeliveryStats.mockResolvedValue({
        averageOperationDurationSeconds: 15,
        averageWorkCost: 0.2,
        lastDeliveredAt: new Date('2026-01-01'),
        workCount: 3,
      });
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));
      const result = await caller.getSharedAgent({ slugOrId: 'shared-agent' });
      expect(result.demoCases).toEqual(demoCases);
      expect(result.agentMeta.openingQuestions).toEqual(['What can you do?']);
      expect(result.featuredWorks).toEqual([work]);
      expect(result.stats).toMatchObject({
        averageOperationDurationSeconds: 15,
        averageWorkCost: 0.2,
        workCount: 3,
      });
      expect(profileModelConstructor).toHaveBeenCalledWith(expect.anything(), 'owner-user');
    });

    it('keeps the profile available when delivery analytics fail', async () => {
      getDeliveryStats.mockRejectedValue(new Error('analytics unavailable'));
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));
      const result = await caller.getSharedAgent({ slugOrId: 'shared-agent' });
      expect(result.stats).toMatchObject(emptyDeliveryStats);
      expect(result.featuredWorks).toEqual([]);
    });

    it('requires authentication without resolving or counting the share', async () => {
      const caller = shareRouter.createCaller(await createContextInner());

      await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(AgentShareModel.findBySlugOrId).not.toHaveBeenCalled();
      expect(AgentShareModel.incrementUserViewCount).not.toHaveBeenCalled();
      expect(listFeaturedWorks).not.toHaveBeenCalled();
      expect(getDeliveryStats).not.toHaveBeenCalled();
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
          openingQuestions: ['What can you do?'],
          tags: ['research'],
          title: 'Research Assistant',
        },
        billingScope: 'personal',
        creator: { avatar: 'owner.png', name: 'Owner Person' },
        demoCases: [],
        featuredWorks: [],
        isOwner: false,
        shareId: 'agent-share-1',
        slug: 'shared-agent',
        stats: { ...emptyDeliveryStats, conversations: 12, views: 42, visitors: 7 },
        terms: {
          allowCreatorViewSessions: false,
          maxFileStorage: 512 * 1024 * 1024,
          maxTopicsPerVisitor: 5,
          maxTurnsPerTopic: 20,
        },
        // Identifier only: the granted API list is owner-facing configuration.
        toolGrants: ['lobe-web-browsing'],
        // Derived from the agent's model abilities; the model itself stays hidden.
        uploadAbility: { audio: false, image: true, video: false },
        visibility: 'link',
      });
      expect(result).not.toHaveProperty('agentModel');
      expect(result).not.toHaveProperty('agentProvider');
      expect(result).not.toHaveProperty('ownerId');
      expect(result).not.toHaveProperty('shareConfig');
      expect(result).not.toHaveProperty('userViewCount');
      // Visitor topics live under the creator's account, so the counter has to
      // run as the owner rather than the caller.
      expect(topicModelConstructor).toHaveBeenCalledWith(
        expect.anything(),
        'owner-user',
        undefined,
      );
      expect(countShareVisitors).toHaveBeenCalledWith({ agentId: 'agent-1' });
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

    it('identifies a Workspace-funded share without exposing its Workspace id', async () => {
      vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue({
        ...agentShare,
        workspaceId: 'workspace-1',
      } as any);
      const caller = shareRouter.createCaller(await createContextInner({ userId: 'visitor-user' }));

      const result = await caller.getSharedAgent({ slugOrId: 'shared-agent' });

      expect(result.billingScope).toBe('workspace');
      expect(result).not.toHaveProperty('workspaceId');
      expect(topicModelConstructor).toHaveBeenCalledWith(
        expect.anything(),
        'owner-user',
        'workspace-1',
      );
    });

    describe('uploadAbility', () => {
      const resolve = async () => {
        const caller = shareRouter.createCaller(
          await createContextInner({ userId: 'visitor-user' }),
        );
        return (await caller.getSharedAgent({ slugOrId: 'shared-agent' })).uploadAbility;
      };

      it('looks the model up as the OWNER, whose overrides the run itself honours', async () => {
        await resolve();

        expect(agentServiceConstructor).toHaveBeenCalledWith(
          expect.anything(),
          'owner-user',
          undefined,
        );
        expect(resolveModelSelectionMock).toHaveBeenCalledWith({
          model: 'gpt-4o',
          provider: 'openai',
        });
        expect(aiModelModelConstructor).toHaveBeenCalledWith(
          expect.anything(),
          'owner-user',
          undefined,
        );
        expect(findByIdAndProviderMock).toHaveBeenCalledWith('gpt-4o', 'openai');
      });

      it("prefers the owner's stored ability override over the bundled list", async () => {
        findByIdAndProviderMock.mockResolvedValue({
          abilities: { audio: true, video: true, vision: false },
        });

        await expect(resolve()).resolves.toEqual({ audio: true, image: false, video: true });
      });

      it("gates on the OWNER's effective model when the agent has none configured", async () => {
        // The run merges the owner's default agent config over the global
        // default, so an agent with no model of its own answers with the
        // owner's default model — the gate must look at that one, not at the
        // global constant.
        vi.mocked(AgentShareModel.findBySlugOrId).mockResolvedValue({
          ...agentShare,
          agentModel: null,
          agentProvider: null,
        } as any);
        resolveModelSelectionMock.mockResolvedValue({
          model: 'claude-sonnet-4',
          provider: 'anthropic',
        });
        loadModelsMock.mockResolvedValue([
          {
            abilities: { audio: false, video: false, vision: true },
            id: 'gpt-4o',
            providerId: 'openai',
          },
          {
            abilities: { audio: true, video: false, vision: false },
            id: 'claude-sonnet-4',
            providerId: 'anthropic',
          },
        ]);

        await expect(resolve()).resolves.toEqual({ audio: true, image: false, video: false });
        expect(resolveModelSelectionMock).toHaveBeenCalledWith({ model: null, provider: null });
        expect(findByIdAndProviderMock).toHaveBeenCalledWith('claude-sonnet-4', 'anthropic');
      });

      it('fails closed when the effective model cannot be resolved', async () => {
        resolveModelSelectionMock.mockRejectedValue(new Error('settings unavailable'));

        await expect(resolve()).resolves.toEqual({ audio: false, image: false, video: false });
        expect(findByIdAndProviderMock).not.toHaveBeenCalled();
      });

      it('fails closed (no media) when the capability lookup throws', async () => {
        loadModelsMock.mockRejectedValue(new Error('bundle missing'));

        await expect(resolve()).resolves.toEqual({ audio: false, image: false, video: false });
      });

      it('fails closed when the model is unknown to both the owner and the bundle', async () => {
        loadModelsMock.mockResolvedValue([]);

        await expect(resolve()).resolves.toEqual({ audio: false, image: false, video: false });
      });
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
      expect(listFeaturedWorks).not.toHaveBeenCalled();
      expect(getDeliveryStats).not.toHaveBeenCalled();
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

      it.each([false, undefined])(
        'admits a non-owner visitor when the agent share flag is %s',
        async (enableAgentShare) => {
          mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare });
          const caller = shareRouter.createCaller(
            await createContextInner({ userId: 'visitor-user' }),
          );

          await expect(caller.getSharedAgent({ slugOrId: 'shared-agent' })).resolves.toMatchObject({
            isOwner: false,
          });
          expect(mockGetFeatureFlagsState).not.toHaveBeenCalled();
          expect(AgentShareModel.incrementUserViewCount).toHaveBeenCalled();
        },
      );

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
