// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { linksRouter } from './links';
import { FANOUT_CAP, fanoutRange, trackInFlight, wechatLink } from './testUtils';

const { mockDeleteByPlatform, mockDisconnectUserMessenger, mockGetServerDB, mockListAccountLinks } =
  vi.hoisted(() => ({
    mockDeleteByPlatform: vi.fn(),
    mockDisconnectUserMessenger: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockListAccountLinks: vi.fn(),
  }));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  fetchQrCode: vi.fn(),
  getWechatTextSendCount: () => 1,
  pollQrStatus: vi.fn(),
}));
vi.mock('@/config/messenger', () => ({
  getEnabledMessengerPlatforms: vi.fn().mockResolvedValue([]),
  getMessengerDiscordConfig: vi.fn(),
  getMessengerSlackConfig: vi.fn(),
  getMessengerTelegramConfig: vi.fn(),
  isMessengerPlatformEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: mockGetServerDB }));
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkConflictError: class extends Error {},
  MessengerAccountLinkRelinkRequiredError: class extends Error {},
  MessengerAccountLinkModel: class {
    deleteByPlatform = mockDeleteByPlatform;
    list = mockListAccountLinks;
  },
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({ kind: 'gatekeeper' }) },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));
vi.mock('@/server/services/messenger', () => ({
  getMessengerRouter: () => ({ invalidateBot: vi.fn() }),
  messengerPlatformRegistry: { listSerializedPlatforms: vi.fn().mockReturnValue([]) },
}));
vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    disconnectUserMessenger = mockDisconnectUserMessenger;
  },
}));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  getBotRuntimeStatus: vi.fn(),
}));
vi.mock('@/server/services/messenger/installations', () => ({
  wechatInstallationKey: (tenantId: string) => `wechat:${tenantId}`,
}));

const createCaller = createCallerFactory(linksRouter);
const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

describe('messenger links fan-outs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockListAccountLinks.mockResolvedValue([]);
  });

  it('unlink bounds WeChat disconnects and disconnects every link', async () => {
    const tracker = trackInFlight(() => undefined);
    mockDisconnectUserMessenger.mockImplementation(tracker.fn);
    mockListAccountLinks.mockResolvedValue(fanoutRange.map(wechatLink));

    await expect((await caller()).unlink({ platform: 'wechat' })).resolves.toEqual({
      success: true,
    });

    expect(mockDeleteByPlatform).toHaveBeenCalledWith('wechat', undefined);
    expect(mockDisconnectUserMessenger.mock.calls.map(([arg]) => arg.installationKey)).toEqual(
      fanoutRange.map((i) => `wechat:wechat-user-${i}`),
    );
    expect(tracker.state.peak).toBeGreaterThan(1);
    expect(tracker.state.peak).toBeLessThanOrEqual(FANOUT_CAP);
  });

  it('unlink still attempts every WeChat disconnect when an early one rejects', async () => {
    const failure = new Error('gateway unavailable');
    const tracker = trackInFlight(({ installationKey }: { installationKey: string }) => {
      if (installationKey === 'wechat:wechat-user-0') throw failure;
    });
    mockDisconnectUserMessenger.mockImplementation(tracker.fn);
    mockListAccountLinks.mockResolvedValue(fanoutRange.map(wechatLink));

    await expect((await caller()).unlink({ platform: 'wechat' })).rejects.toThrow(
      'gateway unavailable',
    );

    expect(mockDeleteByPlatform).toHaveBeenCalledWith('wechat', undefined);
    expect(mockDisconnectUserMessenger).toHaveBeenCalledTimes(fanoutRange.length);
    expect(tracker.state.peak).toBeLessThanOrEqual(FANOUT_CAP);
  });
});
