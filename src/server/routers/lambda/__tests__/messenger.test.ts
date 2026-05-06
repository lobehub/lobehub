// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { messengerRouter } from '../messenger';

const {
  mockGetServerDB,
  mockInitWithEnvKey,
  mockListByInstallerUserId,
  mockMarkRevoked,
  mockSlackAuthTest,
} = vi.hoisted(() => ({
  mockGetServerDB: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockListByInstallerUserId: vi.fn(),
  mockMarkRevoked: vi.fn(),
  mockSlackAuthTest: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findById: vi.fn(),
    listByInstallerUserId: mockListByInstallerUserId,
    markRevoked: mockMarkRevoked,
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SLACK_API_BASE: 'https://slack.com/api',
  SlackApi: vi.fn().mockImplementation(() => ({
    authTest: mockSlackAuthTest,
  })),
}));

const createCaller = createCallerFactory(messengerRouter);

const buildSlackInstall = () => ({
  accountId: null,
  applicationId: 'A_LOBE',
  createdAt: new Date('2026-05-06T00:00:00.000Z'),
  credentials: { botToken: 'xoxb-valid' },
  id: 'install-1',
  installedByPlatformUserId: 'U_INSTALLER',
  installedByUserId: 'user-1',
  metadata: { scope: 'chat:write', tenantName: 'LobeHub' },
  platform: 'slack',
  revokedAt: null,
  tenantId: 'T_LOBE',
  tokenExpiresAt: null,
  updatedAt: new Date('2026-05-06T00:00:00.000Z'),
});

describe('messengerRouter.listMyInstallations', () => {
  const serverDB = { kind: 'server-db' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(serverDB);
    mockInitWithEnvKey.mockResolvedValue(undefined);
  });

  it('keeps active Slack installations visible', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockResolvedValue({ ok: true });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toEqual([
      expect.objectContaining({
        applicationId: 'A_LOBE',
        id: 'install-1',
        platform: 'slack',
        scope: 'chat:write',
        tenantId: 'T_LOBE',
        tenantName: 'LobeHub',
      }),
    ]);
    expect(mockMarkRevoked).not.toHaveBeenCalled();
  });

  it('revokes and hides Slack installs when auth.test reports token revocation', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockRejectedValue(new Error('Slack API auth.test failed: invalid_auth'));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toEqual([]);
    expect(mockMarkRevoked).toHaveBeenCalledWith(serverDB, 'install-1');
  });

  it('does not revoke installs on transient Slack verification failures', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockRejectedValue(new Error('network timeout'));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toHaveLength(1);
    expect(mockMarkRevoked).not.toHaveBeenCalled();
  });
});
