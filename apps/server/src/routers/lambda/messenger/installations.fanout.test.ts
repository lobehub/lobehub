// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { installationsRouter } from './installations';
import {
  FANOUT_CAP,
  FANOUT_COUNT,
  fanoutRange,
  slackInstall,
  trackInFlight,
  wechatLink,
} from './testUtils';

const {
  mockGetBotRuntimeStatus,
  mockGetServerDB,
  mockListAccountLinks,
  mockListByInstallerUserId,
  mockSlackAuthTest,
} = vi.hoisted(() => ({
  mockGetBotRuntimeStatus: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockListAccountLinks: vi.fn(),
  mockListByInstallerUserId: vi.fn(),
  mockSlackAuthTest: vi.fn(),
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
vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findById: vi.fn(),
    listByInstallerUserId: mockListByInstallerUserId,
    markRevoked: vi.fn(),
  },
}));
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkConflictError: class extends Error {},
  MessengerAccountLinkRelinkRequiredError: class extends Error {},
  MessengerAccountLinkModel: class {
    deleteByPlatform = vi.fn();
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
    disconnectUserMessenger = vi.fn();
  },
}));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  getBotRuntimeStatus: mockGetBotRuntimeStatus,
}));
vi.mock('@/server/services/messenger/installations', () => ({
  wechatInstallationKey: (tenantId: string) => `wechat:${tenantId}`,
}));
vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SlackApi: vi.fn().mockImplementation(function () {
    return { authTest: mockSlackAuthTest };
  }),
}));

const createCaller = createCallerFactory(installationsRouter);
const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

describe('messenger installations fan-outs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockListAccountLinks.mockResolvedValue([]);
    mockListByInstallerUserId.mockResolvedValue([]);
  });

  it('listMyInstallations bounds Slack reconciles and keeps their order', async () => {
    const tracker = trackInFlight(() => ({ ok: true }));
    mockSlackAuthTest.mockImplementation(tracker.fn);
    mockListByInstallerUserId.mockResolvedValue(fanoutRange.map(slackInstall));

    const result = await (await caller()).listMyInstallations();

    expect(result.map((view) => view.id)).toEqual(fanoutRange.map((i) => `install-${i}`));
    expect(mockSlackAuthTest).toHaveBeenCalledTimes(FANOUT_COUNT);
    expect(tracker.state.peak).toBeGreaterThan(1);
    expect(tracker.state.peak).toBeLessThanOrEqual(FANOUT_CAP);
  });

  it('listMyInstallations bounds WeChat runtime lookups and keeps their order', async () => {
    const tracker = trackInFlight((_platform: string, applicationId: string) => ({
      applicationId,
      status: 'connected',
    }));
    mockGetBotRuntimeStatus.mockImplementation(tracker.fn);
    mockListAccountLinks.mockResolvedValue(fanoutRange.map(wechatLink));

    const result = await (await caller()).listMyInstallations();

    expect(result.map((view) => [view.id, view.runtime])).toEqual(
      fanoutRange.map((i) => [
        `wechat-link-${i}`,
        { applicationId: `wechat-bot-${i}`, status: 'connected' },
      ]),
    );
    expect(tracker.state.peak).toBeGreaterThan(1);
    expect(tracker.state.peak).toBeLessThanOrEqual(FANOUT_CAP);
  });
});
