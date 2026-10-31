/**
 * Shared doubles and fixtures for the MessengerRouter scenario suites.
 *
 * Each suite registers the module mocks itself (`vi.mock` is hoisted per
 * file) and delegates every factory to the matching `*Module` export here, so
 * all suites share one set of mock functions. The bot loaders import the
 * router lazily so this module never loads it before the mocks are in place.
 */
import { vi } from 'vitest';

export const mockGetBotFeatureAccessState = vi.fn();

/** Factory for `vi.mock('@/database/core/db-adaptor')`. */
export const dbAdaptorModule = () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
});

/** Factory for `vi.mock('@/server/modules/AgentRuntime/redis')`. */
export const agentRuntimeRedisModule = () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
});

/** Factory for `vi.mock('@/business/server/bot/featureAccess')`. */
export const featureAccessModule = () => ({
  getBotFeatureAccessState: mockGetBotFeatureAccessState,
});

/** Factory for `vi.mock('@/envs/gateway')`. */
export const gatewayEnvModule = () => ({
  gatewayEnv: { MESSAGE_GATEWAY_SERVICE_TOKEN: 'gateway-service-token' },
});

export const mockResolveByPayload = vi.fn();
export const mockResolveByKey = vi.fn();
export const mockMarkRevoked = vi.fn();

/** Factory for `vi.mock('../installations')`. */
export const installationsModule = () => ({
  getInstallationStore: vi.fn(() => ({
    markRevoked: mockMarkRevoked,
    resolveByKey: mockResolveByKey,
    resolveByPayload: mockResolveByPayload,
  })),
});

export const mockVerifySignature = vi.fn();
/** Factory for `vi.mock('../oauth/slackOAuth')`. */
export const slackOAuthModule = () => ({
  verifySignature: (...args: any[]) => mockVerifySignature(...args),
});

export const mockGetServerFeatureFlagsStateFromRuntimeConfig = vi.fn();
/** Factory for `vi.mock('@/server/featureFlags')`. */
export const featureFlagsModule = () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: (...args: any[]) =>
    mockGetServerFeatureFlagsStateFromRuntimeConfig(...args),
});

/** Factory for `vi.mock('@/config/messenger')`. */
export const messengerConfigModule = () => ({
  getEnabledMessengerPlatforms: vi.fn().mockReturnValue(['slack', 'telegram']),
  getMessengerSlackConfig: vi.fn().mockReturnValue({
    appId: 'A_APP',
    clientId: 'cid',
    clientSecret: 'csecret',
    signingSecret: 'sigsec',
  }),
  type: undefined,
});

// chat-sdk's `Chat` is heavy + makes network calls. Intercept it so the
// router's bot-load path doesn't actually spin one up. The on* mocks
// double as handler registries — tests pull the registered closures back
// out via `.mock.calls[0][0]` to drive them with fake threads/messages.
export const mockWebhookHandler = vi.fn(async () => new Response('chat-sdk OK', { status: 200 }));
// `openDM` is what slash-command handlers call to resolve a DM Thread on
// demand (slash events don't carry one). Tests pulling slash handlers
// out should pre-populate this with a fake thread so `/new` / `/stop`
// take the DM path instead of falling back to the "open your DM" branch.
export const mockOpenDM = vi.fn();
export const mockSetIfNotExists = vi.fn();
export const mockGetList = vi.fn();
export const mockAppendToList = vi.fn();
export const mockChatBot = {
  dispatchToHandlers: vi.fn(),
  getState: vi.fn(() => ({
    appendToList: (...args: any[]) => mockAppendToList(...args),
    getList: (...args: any[]) => mockGetList(...args),
    setIfNotExists: (...args: any[]) => mockSetIfNotExists(...args),
  })),
  initialize: vi.fn().mockResolvedValue(undefined),
  onAction: vi.fn(),
  onDirectMessage: vi.fn(),
  onMemberJoinedChannel: vi.fn(),
  onNewMention: vi.fn(),
  onSlashCommand: vi.fn(),
  onSubscribedMessage: vi.fn(),
  openDM: mockOpenDM,
  webhooks: {
    slack: mockWebhookHandler,
    telegram: mockWebhookHandler,
    wechat: mockWebhookHandler,
  },
};
/** Factory for `vi.mock('chat')`. */
export const chatModule = () => ({
  Chat: vi.fn(function () {
    return mockChatBot;
  }),
  ConsoleLogger: vi.fn(),
});
/** Factory for `vi.mock('@chat-adapter/state-ioredis')`. */
export const stateIoredisModule = () => ({
  createIoRedisState: vi.fn(),
});

// AgentBridgeService transitively pulls chat-adapter-feishu / others which
// fail to transform in this test env. We capture every constructed
// instance + every call on the static so tests can assert the
// linked-user dispatch path fired without instantiating the real agent
// runtime. Dispatch is split by entry kind: first-touch DMs and channel
// @mentions go through `handleMention`, DM follow-ups on a subscribed
// thread go through `handleSubscribedMessage` so the cached topicId is
// reused — see the comment in `MessengerRouter.dispatchToAgent`.
export const mockHandleMention = vi.fn();
export const mockHandleSubscribed = vi.fn();
export const mockAgentBridgeConstructor = vi.fn();
/** Factory for `vi.mock('@/server/services/bot/AgentBridgeService')`. */
export const agentBridgeServiceModule = () => ({
  AgentBridgeService: class {
    static clearActiveThread = vi.fn();
    static getActiveOperationId = vi.fn();
    static isThreadActive = vi.fn();
    static requestStop = vi.fn();
    constructor(...args: unknown[]) {
      mockAgentBridgeConstructor(...args);
    }
    handleMention = mockHandleMention;
    handleSubscribedMessage = mockHandleSubscribed;
  },
});

// `fetchUserAgents` constructs an AgentModel directly; stub the class so the
// partition test can feed it rows without standing up drizzle. AgentModel's
// methods are instance arrow-function fields, so prototype spies don't work.
export const mockListMessengerBindableAgents = vi.fn();
export const mockAgentExistsById = vi.fn();
export const mockAgentModelConstructor = vi.fn();
export const mockGetAgentConfigById = vi.fn();
/** Factory for `vi.mock('@/database/models/agent')`. */
export const agentModelModule = () => ({
  AgentModel: class {
    constructor(...args: unknown[]) {
      mockAgentModelConstructor(...args);
    }
    existsById = (...args: any[]) => mockAgentExistsById(...args);
    getAgentConfigById = (...args: any[]) => mockGetAgentConfigById(...args);
    listMessengerBindableAgents = (...args: any[]) => mockListMessengerBindableAgents(...args);
  },
});

export const mockFindLink = vi.fn();
export const mockSetActiveAgentById = vi.fn();
export const mockSetActiveScope = vi.fn();
/** Factory for `vi.mock('@/database/models/messengerAccountLink')`. */
export const messengerAccountLinkModule = () => ({
  MessengerAccountLinkModel: {
    findByPlatformUser: (...args: any[]) => mockFindLink(...args),
    setActiveAgentById: (...args: unknown[]) => mockSetActiveAgentById(...args),
    setActiveScope: (...args: any[]) => mockSetActiveScope(...args),
  },
});

// `/switch` and the dispatch-time membership re-validation both enumerate the
// user's workspaces. Default to membership of `workspace-1` so the existing
// workspace-scoped dispatch tests pass; individual tests can override.
export const mockListUserWorkspaces = vi.fn();
/** Factory for `vi.mock('@/database/models/workspace')`. */
export const workspaceModelModule = () => ({
  WorkspaceModel: class {
    listUserWorkspaces = (...args: any[]) => mockListUserWorkspaces(...args);
  },
});
/** Factory for `vi.mock('@/server/services/aiAgent')`. */
export const aiAgentModule = () => ({
  AiAgentService: class {},
});

// `/mode` status parity with execAgent: the effective-mode lookup layers the
// caller's workspace member-mode override over the shared agent config.
export const mockGetWorkspaceUserPreference = vi.fn();
/** Factory for `vi.mock('@/database/models/workspaceUserSettings')`. */
export const workspaceUserSettingsModule = () => ({
  WorkspaceUserSettingsModel: class {
    getPreference = (...args: any[]) => mockGetWorkspaceUserPreference(...args);
  },
});
export const mockIsResourceAuthorOrAdmin = vi.fn();
/** Factory for `vi.mock('@/server/services/resourcePermission')`. */
export const resourcePermissionModule = () => ({
  isResourceAuthorOrAdmin: (...args: any[]) => mockIsResourceAuthorOrAdmin(...args),
});
/** Factory for `vi.mock('@/server/services/bot/replyTemplate')`. */
export const replyTemplateModule = () => ({
  renderCommandReply: (key: string) => {
    if (key === 'cmdModeSetAgent') return 'Switched to Agent Mode';
    if (key === 'cmdModeSetChat') return 'Switched to Chat Mode';
    if (key === 'cmdModeUsage') return 'Usage: /mode agent | chat';
    return key;
  },
  renderInlineError: (msg: string) => msg,
  renderModeStatus: (mode?: 'agent' | 'chat') =>
    mode
      ? `Current mode: ${mode === 'agent' ? 'Agent Mode' : 'Chat Mode'}`
      : 'Current mode: default',
});

// Stub the binder classes (leaf modules) so the real platform definitions +
// slackWebhookGate still load, but createClient returns a usable PlatformClient
// without hitting any platform SDK. `mockSlackBinder` is a single shared
// instance so tests can both pull capture-able mocks off it and observe
// what the registered chat-sdk handlers do with it.
export const mockSlackBinder = {
  createClient: () => ({
    createAdapter: () => ({}),
    // Slack thread.id format is `slack:<channel>:<threadTs?>`. Strip back
    // to the bare channel id so the router's `chatId` matches what the
    // real client returns.
    extractChatId: (id: string) => id.split(':')[1] ?? id,
    registerBotCommands: undefined,
  }),
  extractCallbackAction: undefined,
  handleUnlinkedMessage: vi.fn(),
  notifyLinkSuccess: vi.fn(),
  registerWebhook: vi.fn(),
  replyEphemeral: vi.fn(),
  // `replyPrivately` opts the binder into native slash-command wiring
  // (registerHandlers gates `bot.onSlashCommand` on its presence).
  replyPrivately: vi.fn(),
  sendAgentPicker: vi.fn(),
  sendDmText: vi.fn(),
};
/** Factory for `vi.mock('../platforms/slack/binder')`. */
export const slackBinderModule = () => ({
  MessengerSlackBinder: vi.fn(function () {
    return mockSlackBinder;
  }),
});

export const mockTelegramBinder = {
  createClient: () => ({
    createAdapter: () => ({}),
    // Telegram thread ids are `telegram:<chatId>[:<messageThreadId>]`.
    extractChatId: (id: string) =>
      id.startsWith('telegram:guest:') ? (id.split(':')[2] ?? id) : (id.split(':')[1] ?? id),
  }),
  handleUnlinkedMessage: vi.fn(),
  isOneShotMessage: vi.fn().mockReturnValue(false),
  notifyLinkSuccess: vi.fn(),
  registerWebhook: vi.fn(),
  replyToMessage: vi.fn(),
  sendAgentPicker: vi.fn(),
  sendDmText: vi.fn(),
};
/** Factory for `vi.mock('../platforms/telegram/binder')`. */
export const telegramBinderModule = () => ({
  MessengerTelegramBinder: vi.fn(function () {
    return mockTelegramBinder;
  }),
});

export const mockWechatBinder = {
  createClient: () => ({
    createAdapter: () => ({}),
    extractChatId: (id: string) => id.split(':').at(-1) ?? id,
  }),
  handleUnlinkedMessage: vi.fn(),
  notifyLinkSuccess: vi.fn(),
  sendDmText: vi.fn(),
};
/** Factory for `vi.mock('../platforms/wechat/binder')`. */
export const wechatBinderModule = () => ({
  MessengerWechatBinder: vi.fn(function () {
    return mockWechatBinder;
  }),
});

/** Factory for `vi.mock('../platforms/linq/binder')`. */
export const linqBinderModule = () => ({
  MessengerLinqBinder: vi.fn(function () {
    return { createClient: vi.fn(), handleUnlinkedMessage: vi.fn(), sendDmText: vi.fn() };
  }),
});

export const mockLinqGate = {
  preprocess: vi.fn(async (): Promise<Response | null> => null),
  settle: vi.fn(async () => {}),
};
/** Factory for `vi.mock('../platforms/linq/webhook')`. */
export const linqWebhookModule = () => ({ linqWebhookGate: mockLinqGate });

export const buildSlackRequest = (body: string, headers: Record<string, string> = {}): Request =>
  new Request('https://app.example.com/api/agent/messenger/webhooks/slack', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-slack-signature': 'v0=valid',
      ...headers,
    },
    method: 'POST',
  });

export const slackCreds = (tenantId: string) => ({
  applicationId: 'A_APP',
  botToken: `xoxb-${tenantId}`,
  installationKey: `slack:${tenantId}`,
  metadata: {},
  platform: 'slack' as const,
  signingSecret: 'sigsec',
  tenantId,
});

export const telegramCreds = {
  applicationId: 'telegram:singleton',
  botToken: 'tg-token',
  installationKey: 'telegram:singleton',
  metadata: {},
  platform: 'telegram' as const,
  tenantId: '',
};

export const wechatCreds = {
  applicationId: 'wechat-bot',
  baseUrl: 'https://ilink.example.com',
  botId: 'wechat-bot',
  botToken: 'wechat-token',
  installationKey: 'wechat:wechat-user',
  metadata: {},
  platform: 'wechat' as const,
  tenantId: 'wechat-user',
};

// ---------------------------------------------------------------------------
// Channel @mention dispatch (PR3a)
// ---------------------------------------------------------------------------
//
// The webhook tests above only verify routing into chat-sdk; the channel
// mention contract lives inside the closures the router registers on
// `bot.onNewMention` / `onSubscribedMessage`. We trigger
// bot loading via a no-op webhook and then drive the captured handlers
// directly with synthetic threads + messages so we can assert the unlinked
// (ephemeral) and linked (agent dispatch) branches without standing up the
// real chat-sdk + Slack stack.

export const loadSlackBot = async (): Promise<void> => {
  mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
  const { MessengerRouter } = await import('./index');
  const router = new MessengerRouter();
  await router.getWebhookHandler('slack')(
    buildSlackRequest(
      JSON.stringify({
        authorizations: [{ team_id: 'T_ACME' }],
        event: { type: 'message' },
        type: 'event_callback',
      }),
    ),
  );
};

export const loadTelegramBot = async (): Promise<void> => {
  mockResolveByPayload.mockResolvedValue(telegramCreds);
  const { MessengerRouter } = await import('./index');
  const router = new MessengerRouter();
  await router.getWebhookHandler('telegram')(
    new Request('https://app.example.com/api/agent/messenger/webhooks/telegram', {
      body: JSON.stringify({ message: { text: 'hi' } }),
      method: 'POST',
    }),
  );
};

export const loadWechatBot = async (): Promise<void> => {
  mockResolveByPayload.mockResolvedValue(wechatCreds);
  const { MessengerRouter } = await import('./index');
  const router = new MessengerRouter();
  await router.getWebhookHandler('wechat')(
    new Request('https://app.example.com/api/agent/messenger/webhooks/wechat', {
      body: '{}',
      headers: { authorization: 'Bearer gateway-service-token' },
      method: 'POST',
    }),
  );
};

export const fakeMessage = (overrides: Partial<any> = {}): any => ({
  author: { isBot: false, userId: 'U_ALICE', userName: 'alice' },
  id: 'm1',
  isMention: false,
  text: 'hi',
  ...overrides,
});

export const fakeChannelThread = (): any => ({
  id: 'slack:C_GENERAL:1715000000.000100',
  isDM: false,
  post: vi.fn(),
  subscribe: vi.fn(),
});

export const fakeDmThread = (): any => ({
  id: 'slack:D_DM',
  isDM: true,
  post: vi.fn(),
  subscribe: vi.fn(),
});

export const fakeWechatDmThread = (): any => ({
  id: 'wechat:dm:wechat-user',
  isDM: true,
  post: vi.fn(),
  subscribe: vi.fn(),
});

/** Restore the per-test defaults shared by every suite. */
export function resetMessengerRouterMocks() {
  mockChatBot.dispatchToHandlers = vi.fn();
  mockVerifySignature.mockReturnValue(true);
  mockChatBot.webhooks = {
    slack: mockWebhookHandler,
    telegram: mockWebhookHandler,
    wechat: mockWebhookHandler,
  };
  mockFindLink.mockReset();
  mockSetActiveAgentById.mockReset();
  mockSetActiveScope.mockReset();
  mockListUserWorkspaces.mockReset();
  mockListUserWorkspaces.mockResolvedValue([
    { id: 'workspace-1', name: 'Workspace 1', role: 'owner' },
  ]);
  mockGetServerFeatureFlagsStateFromRuntimeConfig.mockReset();
  mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: true });
  mockGetBotFeatureAccessState.mockReset();
  mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
  mockAgentModelConstructor.mockReset();
  mockAgentExistsById.mockReset();
  // Default: the bound active agent still resolves. Tests that exercise the
  // stale-binding path override this.
  mockAgentExistsById.mockResolvedValue(true);
  mockAgentBridgeConstructor.mockReset();
  mockHandleMention.mockReset();
  mockHandleSubscribed.mockReset();
  mockOpenDM.mockReset();
  mockSetIfNotExists.mockReset();
  mockSetIfNotExists.mockResolvedValue(true);
  mockGetList.mockReset();
  mockGetList.mockResolvedValue([]);
  mockAppendToList.mockReset();
  mockAppendToList.mockResolvedValue(undefined);
  mockSlackBinder.handleUnlinkedMessage.mockReset();
  mockSlackBinder.replyEphemeral.mockReset();
  mockSlackBinder.replyPrivately.mockReset();
  mockSlackBinder.sendAgentPicker.mockReset();
  mockSlackBinder.sendDmText.mockReset();
  mockTelegramBinder.handleUnlinkedMessage.mockReset();
  mockTelegramBinder.isOneShotMessage.mockReset();
  mockTelegramBinder.isOneShotMessage.mockReturnValue(false);
  mockTelegramBinder.replyToMessage.mockReset();
  mockTelegramBinder.sendAgentPicker.mockReset();
  mockTelegramBinder.sendDmText.mockReset();
  mockWechatBinder.handleUnlinkedMessage.mockReset();
  mockWechatBinder.sendDmText.mockReset();
}
