// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextInner } from '@/libs/trpc/lambda/context';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

// `assertAgentShareCreationEnabled` (`_helpers/agentShareFeatureGate.ts`) runs
// for real in this suite — only its own two dependencies are mocked
// (`mockGetFeatureFlagsState` below, and this mutable business-const object)
// — so the router tests exercise the actual gate, not a stand-in.
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

const mockCreate = vi.fn();
const mockGetByAgentId = vi.fn();
const mockUpdateConfig = vi.fn();
const mockUpdateSlug = vi.fn();
const mockUpdateVisibility = vi.fn();

vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: vi.fn(() => ({
    create: mockCreate,
    getByAgentId: mockGetByAgentId,
    updateConfig: mockUpdateConfig,
    updateSlug: mockUpdateSlug,
    updateVisibility: mockUpdateVisibility,
  })),
}));

const mockCountShareVisitors = vi.fn();
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({ countShareVisitors: mockCountShareVisitors })),
}));

const mockGetAgentShareMonthlySpend = vi.fn();
vi.mock('@/business/server/agent-share/spendGate', () => ({
  getAgentShareMonthlySpend: (...args: unknown[]) => mockGetAgentShareMonthlySpend(...args),
}));

const mockGetFeatureFlagsState = vi.fn();
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: (...args: unknown[]) =>
    mockGetFeatureFlagsState(...args),
}));

const { agentShareConfigPatchSchema, agentShareConfigSchema, agentShareRouter } =
  await import('../agentShare');

const share = {
  agentId: 'agent-1',
  id: 'share-1',
  shareConfig: { maxTopicsPerVisitor: 5, maxTurnsPerTopic: 20 },
  visibility: 'private',
};

describe('agentShareRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
    mockCreate.mockResolvedValue(share);
    mockGetByAgentId.mockResolvedValue(share);
    mockUpdateConfig.mockResolvedValue(share);
    mockUpdateSlug.mockResolvedValue({
      ...share,
      shareConfig: { ...share.shareConfig, slug: 'my-slug' },
    });
    mockUpdateVisibility.mockResolvedValue(share);
    mockCountShareVisitors.mockResolvedValue({ topicCount: 7, visitorCount: 3 });
    mockGetAgentShareMonthlySpend.mockResolvedValue(null);
    mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
  });

  it('requires authentication for share management', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner());

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(mockGetByAgentId).not.toHaveBeenCalled();
  });

  it('enables a private share by default', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.enableShare({ agentId: 'agent-1' })).resolves.toEqual(share);
    expect(mockCreate).toHaveBeenCalledWith('agent-1', undefined);
  });

  it('enables a share with an explicit visibility', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.enableShare({ agentId: 'agent-1', visibility: 'link' });
    expect(mockCreate).toHaveBeenCalledWith('agent-1', 'link');
  });

  it('returns null when a personal agent has no share', async () => {
    mockGetByAgentId.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.getShareStatus({ agentId: 'agent-1' })).resolves.toBeNull();
  });

  it('forwards an atomic share configuration patch', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));
    const config = { maxTopicsPerVisitor: 10 };

    await caller.updateShareConfig({ agentId: 'agent-1', config });

    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', config);
  });

  it('rejects an empty share configuration patch', () => {
    expect(agentShareConfigPatchSchema.safeParse({}).success).toBe(false);
  });

  it('requires positive integer topic and turn limits', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 0 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTurnsPerTopic: 1.5 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('caps maxTopicsPerVisitor at the visitor topic list limit', async () => {
    // The visitor topic list (`TopicModel.queryBySender`) is not paginated
    // and is bounded by `AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT` (200), so a
    // cap above it would let visitors create topics they can never reopen.
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 201 },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    await caller.updateShareConfig({
      agentId: 'agent-1',
      config: { maxTopicsPerVisitor: 200 },
    });
    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', { maxTopicsPerVisitor: 200 });
  });

  it('accepts a toolset-level grant and a per-API scoped grant in toolGrants', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));
    const config = {
      toolGrants: [
        { identifier: 'calculator' },
        { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
      ],
    };

    await caller.updateShareConfig({ agentId: 'agent-1', config });

    expect(mockUpdateConfig).toHaveBeenCalledWith('agent-1', config);
  });

  it('rejects a malformed toolGrants entry', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    // Empty identifier.
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { toolGrants: [{ identifier: '' }] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Empty `apis` array — a tool with no granted API must be absent instead.
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { toolGrants: [{ apis: [], identifier: 'lobe-agent' }] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // Unknown key.
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { toolGrants: [{ apiName: 'analyzeMedia', identifier: 'lobe-agent' } as any] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('rejects duplicate identifiers and duplicate api names in toolGrants', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { toolGrants: [{ identifier: 'calculator' }, { identifier: 'calculator' }] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: {
          toolGrants: [{ apis: ['analyzeMedia', 'analyzeMedia'], identifier: 'lobe-agent' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('does not expose dropped v1 config fields in the config API', () => {
    expect(
      agentShareConfigSchema.safeParse({
        filePermissionConfig: { agentFiles: 'read' },
        maxTopicsPerVisitor: 5,
      }).success,
    ).toBe(false);
    expect(
      agentShareConfigSchema.safeParse({
        guestEnabled: true,
        maxTopicsPerVisitor: 5,
      }).success,
    ).toBe(false);
  });

  // Disabling is a pause, not a revocation: it flips the row to `private` and
  // never deletes it, so the share id and slug (i.e. the link already handed
  // out) survive and re-enabling republishes the same url.
  it('disables an existing share by making it private, keeping the row', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.updateVisibility({ agentId: 'agent-1', visibility: 'link' });
    const disabled = await caller.disableShare({ agentId: 'agent-1' });

    expect(mockUpdateVisibility).toHaveBeenNthCalledWith(1, 'agent-1', 'link');
    expect(mockUpdateVisibility).toHaveBeenNthCalledWith(2, 'agent-1', 'private');
    expect(disabled.id).toBe('share-1');
  });

  it('updates the custom slug', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    const result = await caller.updateSlug({ agentId: 'agent-1', slug: 'my-slug' });

    expect(mockUpdateSlug).toHaveBeenCalledWith('agent-1', 'my-slug');
    expect(result.shareConfig).toMatchObject({ slug: 'my-slug' });
  });

  it('lower-cases and trims the slug input before forwarding it', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await caller.updateSlug({ agentId: 'agent-1', slug: '  My-Slug  ' });

    expect(mockUpdateSlug).toHaveBeenCalledWith('agent-1', 'my-slug');
  });

  it('rejects an obviously too-short slug before reaching the model', async () => {
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.updateSlug({ agentId: 'agent-1', slug: 'ab' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mockUpdateSlug).not.toHaveBeenCalled();
  });

  it('propagates a slug conflict as CONFLICT', async () => {
    mockUpdateSlug.mockRejectedValue(
      new TRPCError({ code: 'CONFLICT', message: 'SHARE_SLUG_TAKEN' }),
    );
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateSlug({ agentId: 'agent-1', slug: 'taken-slug' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('returns NOT_FOUND when an existing share is required', async () => {
    mockUpdateConfig.mockResolvedValue(null);
    mockUpdateVisibility.mockResolvedValue(null);
    mockUpdateSlug.mockResolvedValue(null);
    const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.disableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      caller.updateShareConfig({
        agentId: 'agent-1',
        config: { maxTopicsPerVisitor: 5 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.updateSlug({ agentId: 'agent-1', slug: 'my-slug' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  describe('publish capability', () => {
    it('rejects enabling a share on a deployment without business features, even when the flag is on', async () => {
      mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.enableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      // The compile-time gate short-circuits before the flag is even read.
      expect(mockGetFeatureFlagsState).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects enabling a share when the capability is off for this user', async () => {
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: false });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.enableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockGetFeatureFlagsState).toHaveBeenCalledWith('user-1');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects publishing an existing share when the capability is off', async () => {
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: false });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(
        caller.updateVisibility({ agentId: 'agent-1', visibility: 'link' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockUpdateVisibility).not.toHaveBeenCalled();
    });

    it('still lets a user unpublish, read and manage a share when the capability is off', async () => {
      mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: false });
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await caller.updateVisibility({ agentId: 'agent-1', visibility: 'private' });
      await caller.disableShare({ agentId: 'agent-1' });
      await caller.getShareStatus({ agentId: 'agent-1' });
      await caller.updateShareConfig({ agentId: 'agent-1', config: { maxTurnsPerTopic: 3 } });

      expect(mockUpdateVisibility).toHaveBeenCalledWith('agent-1', 'private');
      expect(mockUpdateVisibility).toHaveBeenCalledTimes(2);
    });

    // Fails closed: an unconfigured flag is treated the same as `false`, not
    // as "open" — a deployment must explicitly opt a user in.
    it('rejects publishing when the capability is unconfigured', async () => {
      mockGetFeatureFlagsState.mockResolvedValue({});
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.enableShare({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('getShareStats', () => {
    it('returns visitor aggregates and the configured cap for the owner', async () => {
      mockGetByAgentId.mockResolvedValue({
        ...share,
        shareConfig: { ...share.shareConfig, monthlySpendLimit: 10 },
        userViewCount: 42,
      });
      mockGetAgentShareMonthlySpend.mockResolvedValue(2.5);
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      await expect(caller.getShareStats({ agentId: 'agent-1' })).resolves.toEqual({
        monthlySpend: 2.5,
        monthlySpendLimit: 10,
        topicCount: 7,
        userViewCount: 42,
        visitorCount: 3,
      });
      expect(mockCountShareVisitors).toHaveBeenCalledWith({ agentId: 'agent-1' });
      expect(mockGetAgentShareMonthlySpend).toHaveBeenCalledWith({
        agentId: 'agent-1',
        ownerUserId: 'user-1',
      });
    });

    it('reports unknown spend as null rather than zero', async () => {
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-1' }));

      const stats = await caller.getShareStats({ agentId: 'agent-1' });

      expect(stats.monthlySpend).toBeNull();
    });

    it('refuses stats for an agent the caller does not own', async () => {
      // `getByAgentId` is ownership-scoped, so a non-owner resolves to null.
      mockGetByAgentId.mockResolvedValue(null);
      const caller = agentShareRouter.createCaller(await createContextInner({ userId: 'user-2' }));

      await expect(caller.getShareStats({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockCountShareVisitors).not.toHaveBeenCalled();
      expect(mockGetAgentShareMonthlySpend).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
      const caller = agentShareRouter.createCaller(await createContextInner());

      await expect(caller.getShareStats({ agentId: 'agent-1' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});
