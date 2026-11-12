// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(async () => ({ enableChannels: true })),
}));

const repository = vi.hoisted(() => ({
  updateChannelWakeConfig: vi.fn(),
  updateMemberWakeConfig: vi.fn(),
  wakeConfig: vi.fn(),
}));
vi.mock('@/server/services/channel/ChannelService', () => ({
  ChannelService: vi.fn(function () {
    return { repository };
  }),
}));

const { channelRouter } = await import('../channel');

const channelId = 'chn_abcdefghijkl';
const memberId = '3f2b1c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d';

describe('channelRouter reply strategy', () => {
  const caller = channelRouter.createCaller({ userId: 'user-1' } as any);

  beforeEach(() => vi.clearAllMocks());

  it('writes the channel’s strategy, or a member’s own with its id', async () => {
    await caller.updateWakeConfig({ channelId, wake: { pace: 'calm' } });
    await caller.updateWakeConfig({ channelId, memberId, wake: { rules: { scope: 'none' } } });
    await caller.updateWakeConfig({ channelId, memberId, wake: null });

    expect(repository.updateChannelWakeConfig).toHaveBeenCalledWith(channelId, { pace: 'calm' });
    expect(repository.updateMemberWakeConfig).toHaveBeenNthCalledWith(1, channelId, memberId, {
      rules: { scope: 'none' },
    });
    expect(repository.updateMemberWakeConfig).toHaveBeenNthCalledWith(2, channelId, memberId, null);
  });

  it.each([
    { classifier: { threshold: 2 } },
    { rules: { scope: 'everywhere' } },
    { pace: 'fast' },
    { scheduler: { mode: 'enforce' } },
    { unknown: true },
  ])('refuses an invalid strategy instead of storing it: %j', async (wake) => {
    await expect(caller.updateWakeConfig({ channelId, wake: wake as never })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    expect(repository.updateChannelWakeConfig).not.toHaveBeenCalled();
  });
});
