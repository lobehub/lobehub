// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The caller as Cloud resolves them: a workspace's external contact, or not. */
const caller = vi.hoisted(() => ({ external: true }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    ...(await importOriginal<object>()),
    wsExternalCompatProcedure: authedProcedure.use(
      trpc.middleware(({ next }) =>
        next({ ctx: { isExternalContact: caller.external, workspaceId: 'ws_team' } }),
      ),
    ),
  };
});
vi.mock('@/server/services/channel/featureGate', () => ({
  isChannelEnabled: vi.fn().mockResolvedValue(true),
}));

const channelService = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  openDirect: vi.fn(),
  openPeer: vi.fn(),
  repository: { list: vi.fn(), listJoinable: vi.fn() },
}));
vi.mock('@/server/services/channel/ChannelService', () => ({
  ChannelService: vi.fn(function () {
    return channelService;
  }),
}));

const { channelRouter } = await import('../channel');

const ctx = { serverDB: {}, userId: 'u_bob' } as any;
const channels = () => channelRouter.createCaller(ctx);
const CHANNEL_ID = 'chn_abcdefghijkl';

describe('a workspace external contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caller.external = true;
    channelService.repository.list.mockResolvedValue([]);
    channelService.openPeer.mockResolvedValue({ channel: { id: CHANNEL_ID } });
  });

  it('reaches their one-on-one conversations', async () => {
    await expect(channels().list()).resolves.toEqual({ data: [], success: true });
    await expect(channels().openPeer({ userId: 'u_alice' })).resolves.toEqual({
      data: CHANNEL_ID,
      success: true,
    });
  });

  it('is refused everything else, before the model or service runs', async () => {
    const refused = [
      () => channels().listJoinable(),
      () => channels().join({ channelId: CHANNEL_ID }),
      () => channels().openDirect({ agentId: 'agt_team' }),
      () => channels().userCandidates({}),
    ];
    for (const call of refused)
      await expect(call()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Not available to external contacts',
      });
    expect(channelService.repository.listJoinable).not.toHaveBeenCalled();
    expect(channelService.join).not.toHaveBeenCalled();
    expect(channelService.openDirect).not.toHaveBeenCalled();
  });

  it('leaves members untouched', async () => {
    caller.external = false;
    channelService.repository.listJoinable.mockResolvedValue([]);
    await expect(channels().listJoinable()).resolves.toEqual({ data: [] });
  });
});
