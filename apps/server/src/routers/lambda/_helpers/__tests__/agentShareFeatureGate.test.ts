// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  businessConst: { ENABLE_BUSINESS_FEATURES: true },
  getFlags: vi.fn(),
}));

vi.mock('@lobechat/business-const', () => mocks.businessConst);
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.getFlags,
}));

const { assertAgentShareCreationEnabled, assertAgentShareVisitorEnabled } =
  await import('../agentShareFeatureGate');

describe('assertAgentShareCreationEnabled', () => {
  beforeEach(() => {
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
    mocks.getFlags.mockReset();
  });

  it('rejects on deployments without business features regardless of flags', async () => {
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
    mocks.getFlags.mockResolvedValue({ enableAgentShare: true });

    await expect(assertAgentShareCreationEnabled('user-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // The compile-time gate short-circuits: a self-hosted deployment cannot
    // reach the flag evaluation at all, even with FEATURE_FLAGS=+agent_share.
    expect(mocks.getFlags).not.toHaveBeenCalled();
  });

  it('rejects users outside the grayscale whitelist', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: false });

    await expect(assertAgentShareCreationEnabled('user-1')).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.getFlags).toHaveBeenCalledWith('user-1');
  });

  it('fails closed when the flag is unconfigured', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: undefined });

    await expect(assertAgentShareCreationEnabled('user-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('admits whitelisted users', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: true });

    await expect(assertAgentShareCreationEnabled('user-1')).resolves.toBeUndefined();
  });
});

describe('assertAgentShareVisitorEnabled', () => {
  beforeEach(() => {
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
    mocks.getFlags.mockReset();
  });

  it('rejects on deployments without business features regardless of flags', async () => {
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
    mocks.getFlags.mockResolvedValue({ enableAgentShare: true });

    await expect(assertAgentShareVisitorEnabled('visitor-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.getFlags).not.toHaveBeenCalled();
  });

  it('rejects visitors outside the grayscale whitelist', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: false });

    await expect(assertAgentShareVisitorEnabled('visitor-1')).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.getFlags).toHaveBeenCalledWith('visitor-1');
  });

  it('fails closed when the flag is unconfigured', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: undefined });

    await expect(assertAgentShareVisitorEnabled('visitor-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('admits whitelisted visitors', async () => {
    mocks.getFlags.mockResolvedValue({ enableAgentShare: true });

    await expect(assertAgentShareVisitorEnabled('visitor-1')).resolves.toBeUndefined();
  });
});
