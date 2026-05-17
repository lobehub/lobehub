// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { messengerRouter } from '../messenger';

const {
  mockConsumeLinkToken,
  mockFindByPlatform,
  mockFindByPlatformUser,
  mockGetServerDB,
  mockInitWithEnvKey,
  mockListByInstallerUserId,
  mockMarkRevoked,
  mockNotifyTelegramLinkSuccess,
  mockPeekConsumedLinkToken,
  mockPeekLinkToken,
  mockSlackAuthTest,
  mockUpsertForPlatform,
} = vi.hoisted(() => ({
  mockConsumeLinkToken: vi.fn(),
  mockFindByPlatform: vi.fn(),
  mockFindByPlatformUser: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockListByInstallerUserId: vi.fn(),
  mockMarkRevoked: vi.fn(),
  mockNotifyTelegramLinkSuccess: vi.fn(),
  mockPeekConsumedLinkToken: vi.fn(),
  mockPeekLinkToken: vi.fn(),
  mockSlackAuthTest: vi.fn(),
  mockUpsertForPlatform: vi.fn(),
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

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkConflictError: class MessengerAccountLinkConflictError extends Error {},
  MessengerAccountLinkModel: class MessengerAccountLinkModel {
    static findByPlatformUser = mockFindByPlatformUser;

    findByPlatform = mockFindByPlatform;
    upsertForPlatform = mockUpsertForPlatform;
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/services/messenger', () => ({
  consumeLinkToken: mockConsumeLinkToken,
  MessengerDiscordBinder: vi.fn(),
  messengerPlatformRegistry: {
    listSerializedPlatforms: vi.fn().mockReturnValue([]),
  },
  MessengerSlackBinder: vi.fn(),
  MessengerTelegramBinder: vi.fn().mockImplementation(() => ({
    notifyLinkSuccess: mockNotifyTelegramLinkSuccess,
  })),
  peekConsumedLinkToken: mockPeekConsumedLinkToken,
  peekLinkToken: mockPeekLinkToken,
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

const createSelectBuilder = <T>(result: T) => {
  const builder = {
    from: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
    where: vi.fn(() => builder),
  };

  return builder;
};

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

describe('messengerRouter.peekLinkToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns status:active with payload when the token is live', async () => {
    const selectBuilder = createSelectBuilder([]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      platformUsername: 'alice',
      tenantId: 'T_LOBE',
      tenantName: 'LobeHub',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toMatchObject({
      linkedToEmail: null,
      platform: 'slack',
      platformUserId: 'U_ALICE',
      status: 'active',
      tenantId: 'T_LOBE',
      tenantName: 'LobeHub',
    });
    expect(mockPeekConsumedLinkToken).not.toHaveBeenCalled();
  });

  it('returns status:consumed when the token was already burned by confirmLink', async () => {
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockPeekLinkToken.mockResolvedValue(null);
    mockPeekConsumedLinkToken.mockResolvedValue({
      consumedAt: 1_700_000_000_000,
      platform: 'slack',
      tenantId: 'T_LOBE',
    });

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toEqual({
      platform: 'slack',
      status: 'consumed',
      tenantId: 'T_LOBE',
    });
  });

  it('returns status:expired without throwing when neither token nor consumed marker exists', async () => {
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockPeekLinkToken.mockResolvedValue(null);
    mockPeekConsumedLinkToken.mockResolvedValue(null);

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toEqual({ status: 'expired' });
  });
});

describe('messengerRouter.confirmLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitWithEnvKey.mockResolvedValue(undefined);
  });

  it('blocks linking a different Telegram account when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-new',
      tenantId: '',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-old',
      tenantId: '',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('blocks linking a different Discord account when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'discord',
      platformUserId: 'dc-new',
      tenantId: '',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'discord',
      platformUserId: 'dc-old',
      tenantId: '',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('blocks linking a different Slack account in the same workspace when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_NEW',
      tenantId: 'T_LOBE',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_OLD',
      tenantId: 'T_LOBE',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('allows re-confirming the same Telegram account', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    const linkPayload = {
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
    };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue(linkPayload);
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-same',
      tenantId: '',
    });
    mockConsumeLinkToken.mockResolvedValue(linkPayload);
    mockUpsertForPlatform.mockResolvedValue({ id: 'link-1' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' });

    expect(result).toEqual({ data: { id: 'link-1' }, success: true });
    expect(mockConsumeLinkToken).toHaveBeenCalledWith('rand-1234');
    expect(mockUpsertForPlatform).toHaveBeenCalledWith({
      activeAgentId: 'agent-1',
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
    });
  });
});
