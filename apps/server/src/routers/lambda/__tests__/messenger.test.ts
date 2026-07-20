// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { messengerRouter } from '../messenger';

const {
  mockAcquireWechatQrFinalizeLock,
  mockAssertBotFeatureAccess,
  mockConsumeLinkToken,
  mockConsumeWechatQrSession,
  mockDeleteLink,
  mockDeleteByPlatform,
  mockDisconnectUserMessenger,
  mockEnsureUserMessengerConnected,
  mockFindInstallationById,
  mockFindByPlatform,
  mockFindLinkById,
  mockFindLinkByIdWithCredentials,
  mockFindByPlatformUser,
  mockGetBotRuntimeStatus,
  mockGetBuiltinAgent,
  mockGetAgentRuntimeRedisClient,
  mockGetServerDB,
  mockGetServerFeatureFlagsStateFromRuntimeConfig,
  mockHasAnyPermission,
  mockInitWithEnvKey,
  mockInvalidateMessengerBot,
  mockIsMessengerPlatformEnabled,
  mockListAccountLinks,
  mockListUserWorkspaces,
  mockListByInstallerUserId,
  mockMarkRevoked,
  mockNotifyTelegramLinkSuccess,
  mockPeekWechatQrSession,
  mockPeekConsumedLinkToken,
  mockPeekLinkToken,
  mockPollQrStatus,
  mockReleaseWechatQrFinalizeLock,
  mockSlackAuthTest,
  mockUpsertForPlatform,
} = vi.hoisted(() => ({
  mockAcquireWechatQrFinalizeLock: vi.fn(),
  mockAssertBotFeatureAccess: vi.fn(),
  mockConsumeLinkToken: vi.fn(),
  mockConsumeWechatQrSession: vi.fn(),
  mockDeleteLink: vi.fn(),
  mockDeleteByPlatform: vi.fn(),
  mockDisconnectUserMessenger: vi.fn(),
  mockEnsureUserMessengerConnected: vi.fn(),
  mockFindInstallationById: vi.fn(),
  mockFindByPlatform: vi.fn(),
  mockFindLinkById: vi.fn(),
  mockFindLinkByIdWithCredentials: vi.fn(),
  mockFindByPlatformUser: vi.fn(),
  mockGetBotRuntimeStatus: vi.fn(),
  mockGetBuiltinAgent: vi.fn(),
  mockGetAgentRuntimeRedisClient: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockGetServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockInvalidateMessengerBot: vi.fn(),
  mockIsMessengerPlatformEnabled: vi.fn(),
  mockListAccountLinks: vi.fn(),
  mockListUserWorkspaces: vi.fn(),
  mockListByInstallerUserId: vi.fn(),
  mockMarkRevoked: vi.fn(),
  mockNotifyTelegramLinkSuccess: vi.fn(),
  mockPeekWechatQrSession: vi.fn(),
  mockPeekConsumedLinkToken: vi.fn(),
  mockPeekLinkToken: vi.fn(),
  mockPollQrStatus: vi.fn(),
  mockReleaseWechatQrFinalizeLock: vi.fn(),
  mockSlackAuthTest: vi.fn(),
  mockUpsertForPlatform: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  fetchQrCode: vi.fn(),
  pollQrStatus: mockPollQrStatus,
}));

vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: mockAssertBotFeatureAccess,
  withBotPlatformAccessMeta: vi.fn((platforms) => platforms),
}));

vi.mock('@/config/messenger', () => ({
  getEnabledMessengerPlatforms: vi.fn().mockResolvedValue([]),
  getMessengerDiscordConfig: vi.fn(),
  getMessengerSlackConfig: vi.fn(),
  getMessengerTelegramConfig: vi.fn(),
  isMessengerPlatformEnabled: mockIsMessengerPlatformEnabled,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getBuiltinAgent = (...args: unknown[]) => mockGetBuiltinAgent(...args);
    listMessengerBindableAgents = vi.fn();
  },
}));

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    listUserWorkspaces = (...args: any[]) => mockListUserWorkspaces(...args);
  },
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = (...args: any[]) => mockHasAnyPermission(...args);
  },
}));

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findById: mockFindInstallationById,
    listByInstallerUserId: mockListByInstallerUserId,
    markRevoked: mockMarkRevoked,
  },
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkConflictError: class MessengerAccountLinkConflictError extends Error {},
  MessengerAccountLinkRelinkRequiredError: class MessengerAccountLinkRelinkRequiredError extends Error {},
  MessengerAccountLinkModel: class MessengerAccountLinkModel {
    static findByPlatformUser = mockFindByPlatformUser;

    delete = mockDeleteLink;
    deleteByPlatform = mockDeleteByPlatform;
    findByPlatform = mockFindByPlatform;
    findById = mockFindLinkById;
    findByIdWithCredentials = mockFindLinkByIdWithCredentials;
    list = mockListAccountLinks;
    upsertForPlatform = mockUpsertForPlatform;
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mockGetServerFeatureFlagsStateFromRuntimeConfig,
}));

vi.mock('@/server/services/messenger', () => ({
  acquireWechatQrFinalizeLock: mockAcquireWechatQrFinalizeLock,
  consumeLinkToken: mockConsumeLinkToken,
  consumeWechatQrSession: mockConsumeWechatQrSession,
  getMessengerRouter: () => ({ invalidateBot: mockInvalidateMessengerBot }),
  MessengerDiscordBinder: vi.fn(),
  messengerPlatformRegistry: {
    listSerializedPlatforms: vi.fn().mockReturnValue([]),
  },
  MessengerSlackBinder: vi.fn(),
  MessengerTelegramBinder: vi.fn().mockImplementation(() => ({
    notifyLinkSuccess: mockNotifyTelegramLinkSuccess,
  })),
  peekWechatQrSession: mockPeekWechatQrSession,
  peekConsumedLinkToken: mockPeekConsumedLinkToken,
  peekLinkToken: mockPeekLinkToken,
  releaseWechatQrFinalizeLock: mockReleaseWechatQrFinalizeLock,
}));

vi.mock('@/server/services/gateway', () => ({
  GatewayService: class {
    disconnectUserMessenger = mockDisconnectUserMessenger;
    ensureUserMessengerConnected = mockEnsureUserMessengerConnected;
  },
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  getBotRuntimeStatus: mockGetBotRuntimeStatus,
}));

vi.mock('@/server/services/messenger/installations', () => ({
  wechatInstallationKey: (tenantId: string) => `wechat:${tenantId}`,
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

const createAgentListBuilder = <T>(result: T) => {
  const builder = {
    from: vi.fn(() => builder),
    orderBy: vi.fn().mockResolvedValue(result),
    where: vi.fn(() => builder),
  };

  return builder;
};

describe('messengerRouter.listMyInstallations', () => {
  const serverDB = { kind: 'server-db' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(serverDB);
    mockInitWithEnvKey.mockResolvedValue({ kind: 'gatekeeper' });
    mockListAccountLinks.mockResolvedValue([]);
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

  it('lists WeChat account links and ignores legacy WeChat installation rows', async () => {
    mockListByInstallerUserId.mockResolvedValue([
      { ...buildSlackInstall(), id: 'legacy-wechat-install', platform: 'wechat' },
    ]);
    mockListAccountLinks.mockResolvedValue([
      {
        activeAgentId: 'agent-1',
        applicationId: 'wechat-bot',
        createdAt: new Date('2026-07-17T00:00:00.000Z'),
        id: 'wechat-link',
        platform: 'wechat',
        platformUserId: 'wechat-user',
        tenantId: 'wechat-user',
        userId: 'user-1',
        workspaceId: null,
      },
    ]);
    mockGetBotRuntimeStatus.mockResolvedValue({ status: 'connected' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toEqual([
      expect.objectContaining({
        applicationId: 'wechat-bot',
        id: 'wechat-link',
        platform: 'wechat',
        tenantId: 'wechat-user',
      }),
    ]);
  });
});

describe('messengerRouter.pollWechatQrSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMessengerPlatformEnabled.mockResolvedValue(true);
    mockAssertBotFeatureAccess.mockResolvedValue(undefined);
    mockPeekWechatQrSession.mockResolvedValue({ qrcode: 'qr-code', userId: 'user-1' });
    mockPollQrStatus.mockResolvedValue({
      baseurl: 'https://ilink.example.com',
      bot_token: 'bot-token',
      ilink_bot_id: 'wechat-bot',
      ilink_user_id: 'wechat-user',
      status: 'confirmed',
    });
    mockAcquireWechatQrFinalizeLock.mockResolvedValue('lock-token');
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue(undefined);
    mockFindLinkByIdWithCredentials.mockResolvedValue(undefined);
    mockGetBuiltinAgent.mockResolvedValue({ id: 'agent-inbox' });
    mockInitWithEnvKey.mockResolvedValue({ kind: 'gatekeeper' });
    mockListByInstallerUserId.mockResolvedValue([]);
    mockUpsertForPlatform.mockResolvedValue({
      activeAgentId: 'agent-inbox',
      applicationId: 'wechat-bot',
      createdAt: new Date('2026-07-17T00:00:00.000Z'),
      id: 'link-1',
      platform: 'wechat',
      tenantId: 'wechat-user',
      workspaceId: null,
    });
    mockEnsureUserMessengerConnected.mockResolvedValue('messenger:wechat:wechat-user:user-user-1');
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);
    mockGetBotRuntimeStatus.mockResolvedValue({ status: 'connected' });
    mockConsumeWechatQrSession.mockResolvedValue(undefined);
  });

  it('routes a first WeChat connection to the personal LobeAI agent', async () => {
    const selectBuilder = createSelectBuilder([
      { id: 'agent-inbox', title: 'LobeAI', userId: 'user-1', workspaceId: null },
    ]);
    const serverDB = {
      select: vi.fn(() => selectBuilder),
      transaction: vi.fn(),
    };
    serverDB.transaction.mockImplementation(async (callback: (tx: typeof serverDB) => unknown) =>
      callback(serverDB),
    );
    mockGetServerDB.mockResolvedValue(serverDB);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.pollWechatQrSession({ sessionId: 'session-1' });

    expect(result).toMatchObject({
      link: { activeAgentId: 'agent-inbox', workspaceId: null },
      status: 'confirmed',
    });
    expect(mockUpsertForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        activeAgentId: 'agent-inbox',
        applicationId: 'wechat-bot',
        credentials: {
          baseUrl: 'https://ilink.example.com',
          botId: 'wechat-bot',
          botToken: 'bot-token',
        },
        workspaceId: null,
      }),
      { kind: 'gatekeeper' },
    );
  });

  it('falls back to the personal LobeAI agent when a rescan preserves a stale agent', async () => {
    mockFindByPlatform.mockResolvedValueOnce({
      activeAgentId: 'agent-deleted',
      applicationId: 'wechat-bot-old',
      id: 'link-1',
      platformUserId: 'wechat-user',
      tenantId: 'wechat-user',
    });
    mockFindLinkByIdWithCredentials.mockResolvedValueOnce({
      activeAgentId: 'agent-deleted',
      applicationId: 'wechat-bot-old',
      credentials: { baseUrl: 'https://old.example.com', botToken: 'old-token' },
      id: 'link-1',
      platformUserId: 'wechat-user',
      platformUsername: null,
      tenantId: 'wechat-user',
      workspaceId: null,
    });
    const staleAgentBuilder = createSelectBuilder([]);
    const inboxAgentBuilder = createSelectBuilder([
      { id: 'agent-inbox', title: 'LobeAI', userId: 'user-1', workspaceId: null },
    ]);
    const serverDB = {
      select: vi.fn().mockReturnValueOnce(staleAgentBuilder).mockReturnValueOnce(inboxAgentBuilder),
      transaction: vi.fn(),
    };
    serverDB.transaction.mockImplementation(async (callback: (tx: typeof serverDB) => unknown) =>
      callback(serverDB),
    );
    mockGetServerDB.mockResolvedValue(serverDB);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    await expect(caller.pollWechatQrSession({ sessionId: 'session-1' })).resolves.toMatchObject({
      status: 'confirmed',
    });

    expect(mockUpsertForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ activeAgentId: 'agent-inbox', workspaceId: null }),
      { kind: 'gatekeeper' },
    );
    // The rescan replaced the QR-issued credentials — the cached Chat SDK bot
    // must be evicted so webhooks stop replying through the old token/baseUrl.
    expect(mockInvalidateMessengerBot).toHaveBeenCalledWith('wechat:wechat-user');
  });

  it('rolls back the persisted connection when the Message Gateway poller cannot start', async () => {
    const selectBuilder = createSelectBuilder([
      { id: 'agent-inbox', title: 'LobeAI', userId: 'user-1', workspaceId: null },
    ]);
    const serverDB = {
      select: vi.fn(() => selectBuilder),
      transaction: vi.fn(),
    };
    serverDB.transaction.mockImplementation(async (callback: (tx: typeof serverDB) => unknown) =>
      callback(serverDB),
    );
    mockGetServerDB.mockResolvedValue(serverDB);
    mockEnsureUserMessengerConnected.mockResolvedValueOnce(null);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.pollWechatQrSession({ sessionId: 'session-1' })).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'messenger.wechat.error.connectionFailed',
    });
    expect(mockDeleteByPlatform).toHaveBeenCalledWith('wechat', 'wechat-user');
    expect(mockMarkRevoked).not.toHaveBeenCalled();
    expect(mockConsumeWechatQrSession).not.toHaveBeenCalled();
    expect(mockReleaseWechatQrFinalizeLock).toHaveBeenCalledWith('session-1', 'lock-token');
  });

  it('restores the previous account-link credentials when a rescan cannot start', async () => {
    const previousLink = {
      activeAgentId: 'agent-inbox',
      applicationId: 'wechat-bot-old',
      credentials: {
        baseUrl: 'https://old.example.com',
        botId: 'wechat-bot-old',
        botToken: 'old-token',
      },
      id: 'link-1',
      platformUserId: 'wechat-user',
      platformUsername: null,
      tenantId: 'wechat-user',
      workspaceId: null,
    };
    mockFindByPlatform.mockResolvedValueOnce(previousLink);
    mockFindLinkByIdWithCredentials.mockResolvedValueOnce(previousLink);
    mockEnsureUserMessengerConnected
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('restored-connection');

    const selectBuilder = createSelectBuilder([
      { id: 'agent-inbox', title: 'LobeAI', userId: 'user-1', workspaceId: null },
    ]);
    const serverDB = {
      select: vi.fn(() => selectBuilder),
      transaction: vi.fn(),
    };
    serverDB.transaction.mockImplementation(async (callback: (tx: typeof serverDB) => unknown) =>
      callback(serverDB),
    );
    mockGetServerDB.mockResolvedValue(serverDB);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    await expect(caller.pollWechatQrSession({ sessionId: 'session-1' })).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
    });

    expect(mockUpsertForPlatform).toHaveBeenNthCalledWith(
      2,
      {
        activeAgentId: 'agent-inbox',
        applicationId: 'wechat-bot-old',
        credentials: previousLink.credentials,
        platform: 'wechat',
        platformUserId: 'wechat-user',
        platformUsername: null,
        tenantId: 'wechat-user',
        workspaceId: null,
      },
      { kind: 'gatekeeper' },
    );
    expect(mockDeleteByPlatform).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.uninstallInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockInitWithEnvKey.mockResolvedValue({ kind: 'gatekeeper' });
  });

  it('deletes a WeChat account link and disconnects its gateway poller', async () => {
    mockFindLinkById.mockResolvedValue({
      applicationId: 'wechat-bot',
      id: 'wechat-link',
      platform: 'wechat',
      tenantId: 'wechat-user',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    await expect(caller.uninstallInstallation({ installationId: 'wechat-link' })).resolves.toEqual({
      success: true,
    });

    expect(mockDeleteLink).toHaveBeenCalledWith('wechat-link');
    expect(mockDisconnectUserMessenger).toHaveBeenCalledWith({
      installationKey: 'wechat:wechat-user',
      platform: 'wechat',
      userId: 'user-1',
    });
    expect(mockFindInstallationById).not.toHaveBeenCalled();
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
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: true });
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
    const selectBuilder = createSelectBuilder([
      { id: 'agent-1', title: 'Agent 1', userId: 'user-1', workspaceId: null },
    ]);
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
      workspaceId: null,
    });
  });

  it('blocks binding a workspace agent when workspace feature is disabled', async () => {
    const selectBuilder = createSelectBuilder([
      {
        id: 'agent-1',
        title: 'Workspace Agent',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    ]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    const linkPayload = {
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
    };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockPeekLinkToken.mockResolvedValue(linkPayload);
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue(undefined);
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);
    mockHasAnyPermission.mockResolvedValue(true);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Workspace feature is not enabled for this user',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.listBindingScopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({});
  });

  it('returns no workspace scopes when workspace feature is disabled', async () => {
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listBindingScopes();

    expect(result).toEqual([]);
    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.listAgentsForBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({});
  });

  it('rejects workspace-scoped agent listing when workspace feature is disabled', async () => {
    const selectBuilder = createAgentListBuilder([]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.listAgentsForBinding({ workspaceId: 'workspace-1' })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
        message: 'Workspace feature is not enabled for this user',
      },
    );

    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
  });
});
