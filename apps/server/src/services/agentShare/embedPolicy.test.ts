import type * as BusinessConst from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  business: true,
  findBySlugOrId: vi.fn(),
  flags: vi.fn(),
}));

vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');
  return {
    ...actual,
    get ENABLE_BUSINESS_FEATURES() {
      return mocks.business;
    },
  };
});
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: { findBySlugOrId: mocks.findBySlugOrId },
}));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.flags,
}));

const { resolveAgentEmbedFrameAncestors, resolveAgentEmbedOrigins } = await import('./embedPolicy');

const linkShare = {
  ownerId: 'creator-1',
  shareConfig: { embedAllowedOrigins: ['https://docs.example.com', 'https://*.example.org'] },
  visibility: 'link',
};

describe('resolveAgentEmbedFrameAncestors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.business = true;
    mocks.findBySlugOrId.mockResolvedValue(linkShare);
    mocks.flags.mockResolvedValue({ enableAgentEmbed: true });
  });

  it("lists the share's allowed origins, gated on the CREATOR's flag", async () => {
    expect(await resolveAgentEmbedFrameAncestors('my-bot')).toBe(
      'frame-ancestors https://docs.example.com https://*.example.org',
    );
    expect(mocks.findBySlugOrId).toHaveBeenCalledWith({}, 'my-bot');
    expect(mocks.flags).toHaveBeenCalledWith('creator-1');
  });

  it.each([
    ['the deployment has no Agent Share', () => (mocks.business = false)],
    ['the share does not exist', () => mocks.findBySlugOrId.mockResolvedValue(null)],
    [
      'the share is paused',
      () => mocks.findBySlugOrId.mockResolvedValue({ ...linkShare, visibility: 'private' }),
    ],
    [
      'the allowlist is empty',
      () =>
        mocks.findBySlugOrId.mockResolvedValue({
          ...linkShare,
          shareConfig: { embedAllowedOrigins: [] },
        }),
    ],
    [
      'the creator is outside the agent_embed rollout',
      () => mocks.flags.mockResolvedValue({ enableAgentEmbed: false }),
    ],
    ['the lookup fails', () => mocks.findBySlugOrId.mockRejectedValue(new Error('db down'))],
  ])('forbids framing when %s', async (_label, arrange) => {
    arrange();

    expect(await resolveAgentEmbedFrameAncestors('my-bot')).toBe("frame-ancestors 'none'");
    expect(await resolveAgentEmbedOrigins('my-bot')).toEqual([]);
  });

  it('never emits a stored entry that is not a valid origin', async () => {
    mocks.findBySlugOrId.mockResolvedValue({
      ...linkShare,
      shareConfig: { embedAllowedOrigins: ["https://a.com; script-src 'unsafe-inline'"] },
    });

    expect(await resolveAgentEmbedFrameAncestors('my-bot')).toBe("frame-ancestors 'none'");
  });
});
