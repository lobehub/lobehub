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

const flags = vi.hoisted(() => ({ enableChannels: false as boolean | undefined }));
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(async () => flags),
}));

const list = vi.fn();
vi.mock('@/server/services/channel/ChannelService', () => ({
  ChannelService: vi.fn(function () {
    return { repository: { list } };
  }),
}));

const { channelRouter } = await import('../channel');

describe('channelRouter feature flag', () => {
  const caller = channelRouter.createCaller({ userId: 'user-1' } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([]);
  });

  it.each([false, undefined])('refuses every call while `channel` is %s', async (value) => {
    flags.enableChannels = value;
    await expect(caller.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(list).not.toHaveBeenCalled();
  });

  it('serves the call once the flag is on for the user', async () => {
    flags.enableChannels = true;
    await expect(caller.list()).resolves.toEqual({ data: [], success: true });
  });
});
