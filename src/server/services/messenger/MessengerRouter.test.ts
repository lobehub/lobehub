// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerRouter } from './MessengerRouter';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));

const mockResolveByPayload = vi.fn();
const mockResolveByKey = vi.fn();
const mockMarkRevoked = vi.fn();

vi.mock('./installations', () => ({
  getInstallationStore: vi.fn(() => ({
    markRevoked: mockMarkRevoked,
    resolveByKey: mockResolveByKey,
    resolveByPayload: mockResolveByPayload,
  })),
}));

const mockVerifySignature = vi.fn();
vi.mock('./oauth/slackOAuth', () => ({
  verifySignature: (...args: any[]) => mockVerifySignature(...args),
}));

vi.mock('@/config/messenger', () => ({
  getEnabledMessengerPlatforms: vi.fn().mockReturnValue(['slack', 'telegram']),
  getMessengerSlackConfig: vi.fn().mockReturnValue({
    appId: 'A_APP',
    clientId: 'cid',
    clientSecret: 'csecret',
    signingSecret: 'sigsec',
  }),
  type: undefined,
}));

// chat-sdk's `Chat` is heavy + makes network calls. Intercept it so the
// router's bot-load path doesn't actually spin one up. The on* mocks
// double as handler registries — tests pull the registered closures back
// out via `.mock.calls[0][0]` to drive them with fake threads/messages.
const mockWebhookHandler = vi.fn(async () => new Response('chat-sdk OK', { status: 200 }));
// `openDM` is what slash-command handlers call to resolve a DM Thread on
// demand (slash events don't carry one). Tests pulling slash handlers
// out should pre-populate this with a fake thread so `/new` / `/stop`
// take the DM path instead of falling back to the "open your DM" branch.
const mockOpenDM = vi.fn();
const mockSetIfNotExists = vi.fn();
const mockGetList = vi.fn();
const mockAppendToList = vi.fn();
const mockChatBot = {
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
  },
};
vi.mock('chat', () => ({
  Chat: vi.fn().mockImplementation(() => mockChatBot),
  ConsoleLogger: vi.fn(),
}));
vi.mock('@chat-adapter/state-ioredis', () => ({
  createIoRedisState: vi.fn(),
}));

// AgentBridgeService transitively pulls chat-adapter-feishu / others which
// fail to transform in this test env. We capture every constructed
// instance + every call on the static so tests can assert the
// linked-user dispatch path fired without instantiating the real agent
// runtime. Dispatch is split by entry kind: first-touch DMs and channel
// @mentions go through `handleMention`, DM follow-ups on a subscribed
// thread go through `handleSubscribedMessage` so the cached topicId is
// reused — see the comment in `MessengerRouter.dispatchToAgent`.
const mockHandleMention = vi.fn();
const mockHandleSubscribed = vi.fn();
vi.mock('@/server/services/bot/AgentBridgeService', () => ({
  AgentBridgeService: class {
    static clearActiveThread = vi.fn();
    static getActiveOperationId = vi.fn();
    static isThreadActive = vi.fn();
    static requestStop = vi.fn();
    handleMention = mockHandleMention;
    handleSubscribedMessage = mockHandleSubscribed;
  },
}));

const mockFindLink = vi.fn();
vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: {
    findByPlatformUser: (...args: any[]) => mockFindLink(...args),
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {},
}));
vi.mock('@/server/services/bot/replyTemplate', () => ({
  renderInlineError: (msg: string) => msg,
}));

// Stub the binder classes (leaf modules) so the real platform definitions +
// slackWebhookGate still load, but createClient returns a usable PlatformClient
// without hitting any platform SDK. `mockSlackBinder` is a single shared
// instance so tests can both pull capture-able mocks off it and observe
// what the registered chat-sdk handlers do with it.
const mockSlackBinder = {
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
vi.mock('./platforms/slack/binder', () => ({
  MessengerSlackBinder: vi.fn().mockImplementation(() => mockSlackBinder),
}));

vi.mock('./platforms/telegram/binder', () => ({
  MessengerTelegramBinder: vi.fn().mockImplementation(() => ({
    createClient: () => ({
      createAdapter: () => ({}),
      extractChatId: (id: string) => id,
    }),
    handleUnlinkedMessage: vi.fn(),
    notifyLinkSuccess: vi.fn(),
    registerWebhook: vi.fn(),
    sendDmText: vi.fn(),
  })),
}));

const buildSlackRequest = (body: string, headers: Record<string, string> = {}): Request =>
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

const slackCreds = (tenantId: string) => ({
  applicationId: 'A_APP',
  botToken: `xoxb-${tenantId}`,
  installationKey: `slack:${tenantId}`,
  metadata: {},
  platform: 'slack' as const,
  signingSecret: 'sigsec',
  tenantId,
});

beforeEach(() => {
  mockVerifySignature.mockReturnValue(true);
  mockChatBot.webhooks = {
    slack: mockWebhookHandler,
    telegram: mockWebhookHandler,
  };
  mockFindLink.mockReset();
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerRouter.getWebhookHandler', () => {
  it('rejects unknown platforms with 404', async () => {
    const router = new MessengerRouter();
    const handler = router.getWebhookHandler('discord');
    const res = await handler(new Request('https://e.com/x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });

  it('returns 401 when Slack signature headers are missing', async () => {
    const router = new MessengerRouter();
    const handler = router.getWebhookHandler('slack');
    const req = new Request('https://e.com/x', { body: '{}', method: 'POST' });
    const res = await handler(req);
    expect(res.status).toBe(401);
    expect(mockVerifySignature).not.toHaveBeenCalled();
  });

  it('returns 401 when Slack signature is invalid', async () => {
    mockVerifySignature.mockReturnValue(false);
    const router = new MessengerRouter();
    const res = await router.getWebhookHandler('slack')(buildSlackRequest('{}'));
    expect(res.status).toBe(401);
    expect(mockResolveByPayload).not.toHaveBeenCalled();
  });

  it('responds to Slack url_verification challenge with the challenge value', async () => {
    const router = new MessengerRouter();
    const body = JSON.stringify({ challenge: 'abc123', type: 'url_verification' });
    const res = await router.getWebhookHandler('slack')(buildSlackRequest(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
    expect(mockResolveByPayload).not.toHaveBeenCalled();
  });

  it('marks the install revoked on app_uninstalled and short-circuits with 200', async () => {
    const router = new MessengerRouter();
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'app_uninstalled' },
      type: 'event_callback',
    });
    const res = await router.getWebhookHandler('slack')(buildSlackRequest(body));
    expect(res.status).toBe(200);
    expect(mockMarkRevoked).toHaveBeenCalledWith('slack:T_ACME');
    expect(mockResolveByPayload).not.toHaveBeenCalled();
  });

  it('marks the install revoked on tokens_revoked too', async () => {
    const router = new MessengerRouter();
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'tokens_revoked' },
      type: 'event_callback',
    });
    await router.getWebhookHandler('slack')(buildSlackRequest(body));
    expect(mockMarkRevoked).toHaveBeenCalledWith('slack:T_ACME');
  });

  it('returns 404 when no install is resolved for the inbound payload', async () => {
    mockResolveByPayload.mockResolvedValue(null);
    const router = new MessengerRouter();
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_UNKNOWN' }],
      event: { type: 'message' },
      type: 'event_callback',
    });
    const res = await router.getWebhookHandler('slack')(buildSlackRequest(body));
    expect(res.status).toBe(404);
  });

  it('caches one bot per installationKey across consecutive calls', async () => {
    mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
    const router = new MessengerRouter();
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'message' },
      type: 'event_callback',
    });

    // Two calls for the same workspace should reuse the same Chat SDK instance.
    await router.getWebhookHandler('slack')(buildSlackRequest(body));
    await router.getWebhookHandler('slack')(buildSlackRequest(body));

    const { Chat } = await import('chat');
    expect(Chat).toHaveBeenCalledTimes(1);
  });

  it('keeps separate bots for different installs', async () => {
    mockResolveByPayload.mockImplementation(async (_req, raw: string) => {
      const parsed = JSON.parse(raw);
      const teamId = parsed.authorizations?.[0]?.team_id;
      return teamId ? slackCreds(teamId) : null;
    });

    const router = new MessengerRouter();
    const acmeBody = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'message' },
      type: 'event_callback',
    });
    const betaBody = JSON.stringify({
      authorizations: [{ team_id: 'T_BETA' }],
      event: { type: 'message' },
      type: 'event_callback',
    });

    await router.getWebhookHandler('slack')(buildSlackRequest(acmeBody));
    await router.getWebhookHandler('slack')(buildSlackRequest(betaBody));

    const { Chat } = await import('chat');
    // Two distinct workspaces → two Chat SDK instances.
    expect(Chat).toHaveBeenCalledTimes(2);
  });

  it('forwards the (reconstructed) request to the chat-sdk webhook handler on a real message', async () => {
    mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
    const router = new MessengerRouter();
    const body = JSON.stringify({
      authorizations: [{ team_id: 'T_ACME' }],
      event: { type: 'message' },
      type: 'event_callback',
    });
    const res = await router.getWebhookHandler('slack')(buildSlackRequest(body));
    expect(res.status).toBe(200);
    expect(mockWebhookHandler).toHaveBeenCalledTimes(1);
    // Reconstructed request preserves the body (raw bytes are still readable).
    const calls = mockWebhookHandler.mock.calls as unknown as Request[][];
    const passedReq = calls[0][0];
    expect(await passedReq.text()).toBe(body);
  });

  it('skips signature verification for telegram (no headers required)', async () => {
    mockResolveByPayload.mockResolvedValue({
      applicationId: 'telegram:singleton',
      botToken: 'tg-token',
      installationKey: 'telegram:singleton',
      metadata: {},
      platform: 'telegram',
      tenantId: '',
    });
    const router = new MessengerRouter();
    const req = new Request('https://e.com/api/agent/messenger/webhooks/telegram', {
      body: JSON.stringify({ message: { text: 'hi' } }),
      method: 'POST',
    });
    const res = await router.getWebhookHandler('telegram')(req);
    expect(res.status).toBe(200);
    expect(mockVerifySignature).not.toHaveBeenCalled();
  });
});

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

const loadSlackBot = async (): Promise<void> => {
  mockResolveByPayload.mockResolvedValue(slackCreds('T_ACME'));
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

const fakeMessage = (overrides: Partial<any> = {}): any => ({
  author: { isBot: false, userId: 'U_ALICE', userName: 'alice' },
  id: 'm1',
  isMention: false,
  text: 'hi',
  ...overrides,
});

const fakeChannelThread = (): any => ({
  id: 'slack:C_GENERAL:1715000000.000100',
  isDM: false,
  post: vi.fn(),
  subscribe: vi.fn(),
});

const fakeDmThread = (): any => ({
  id: 'slack:D_DM',
  isDM: true,
  post: vi.fn(),
  subscribe: vi.fn(),
});

describe('MessengerRouter channel @mention', () => {
  it('dispatches a linked user mention to the active agent (in-thread reply)', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const thread = fakeChannelThread();
    await handler(thread, fakeMessage({ isMention: true, text: '<@U_BOT> summarise' }));

    // Linked → AgentBridgeService.handleMention is invoked with the
    // user-active agent and the channel thread (chat-adapter-slack handles
    // thread_ts on the underlying chat.postMessage). `onNewMention` is a
    // first-touch entry, so dispatch goes through `handleMention` (mirrors
    // BotMessageRouter).
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockHandleMention.mock.calls[0][2]).toMatchObject({ agentId: 'agt_main' });
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    // We deliberately do NOT subscribe channel threads — see comment in
    // `onNewMention`.
    expect(thread.subscribe).not.toHaveBeenCalled();
    expect(mockSlackBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
    expect(mockSlackBinder.replyEphemeral).not.toHaveBeenCalled();
  });

  it('routes an unlinked channel mention through handleUnlinkedMessage with channelMentionThreadId', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true, text: '<@U_BOT> hi' }));

    // The Slack binder handles the channel-vs-DM branch — the router only
    // signals which surface this came from via channelMentionThreadId.
    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0]).toMatchObject({
      authorUserId: 'U_ALICE',
      channelMentionThreadId: 'slack:C_GENERAL:1715000000.000100',
      chatId: 'C_GENERAL',
    });
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
  });

  it('replies ephemerally when a linked user has no active agent in a channel mention', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: null,
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: true }));

    expect(mockSlackBinder.replyEphemeral).toHaveBeenCalledWith({
      channelId: 'C_GENERAL',
      text: expect.stringContaining('No active agent'),
      threadTs: '1715000000.000100',
      userId: 'U_ALICE',
    });
    // Public DM-style nudge is suppressed in channels.
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter member_joined_channel welcome', () => {
  it('posts a welcome message when the bot itself joins a channel', async () => {
    await loadSlackBot();

    const handler = mockChatBot.onMemberJoinedChannel.mock.calls[0][0] as (
      event: any,
    ) => Promise<void>;
    await handler({
      adapter: { botUserId: 'U_BOT' },
      channelId: 'slack:C_GENERAL:',
      inviterId: 'U_ALICE',
      userId: 'U_BOT',
    });

    expect(mockSetIfNotExists).toHaveBeenCalledWith('channel_welcomed:C_GENERAL', '1');
    expect(mockSlackBinder.sendDmText).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.sendDmText.mock.calls[0][0]).toBe('C_GENERAL');
    expect(mockSlackBinder.sendDmText.mock.calls[0][1]).toMatch(/LobeHub/);
  });

  it('does nothing when a regular user (not the bot) joins the channel', async () => {
    await loadSlackBot();

    const handler = mockChatBot.onMemberJoinedChannel.mock.calls[0][0] as (
      event: any,
    ) => Promise<void>;
    await handler({
      adapter: { botUserId: 'U_BOT' },
      channelId: 'slack:C_GENERAL:',
      userId: 'U_ALICE',
    });

    expect(mockSetIfNotExists).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('skips the welcome on a duplicate member_joined_channel delivery', async () => {
    await loadSlackBot();
    mockSetIfNotExists.mockResolvedValueOnce(false);

    const handler = mockChatBot.onMemberJoinedChannel.mock.calls[0][0] as (
      event: any,
    ) => Promise<void>;
    await handler({
      adapter: { botUserId: 'U_BOT' },
      channelId: 'slack:C_GENERAL:',
      userId: 'U_BOT',
    });

    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });

  it('drops the event when the adapter has no resolved bot user id yet', async () => {
    await loadSlackBot();

    const handler = mockChatBot.onMemberJoinedChannel.mock.calls[0][0] as (
      event: any,
    ) => Promise<void>;
    await handler({
      adapter: { botUserId: undefined },
      channelId: 'slack:C_GENERAL:',
      userId: 'U_BOT',
    });

    expect(mockSetIfNotExists).not.toHaveBeenCalled();
    expect(mockSlackBinder.sendDmText).not.toHaveBeenCalled();
  });
});

describe('MessengerRouter DM dispatch (regression)', () => {
  it('does not register an onDirectMessage handler', async () => {
    // The router intentionally skips `onDirectMessage` so chat-sdk's DM
    // dispatch falls through to the standard mention/subscription routing
    // (mirrors BotMessageRouter). Registering it would short-circuit
    // `isSubscribed` and prevent DM follow-ups from continuing the cached
    // topic via `handleSubscribedMessage`.
    await loadSlackBot();
    expect(mockChatBot.onDirectMessage).not.toHaveBeenCalled();
  });

  it('routes a linked first-touch DM (forced @mention by chat-sdk) via handleMention', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    // chat-sdk forces `isMention = true` for DMs when no DM handler is
    // registered, so the first DM lands in `onNewMention`. `handleMention`
    // opens a fresh topic and subscribes the thread; later DMs flow
    // through `onSubscribedMessage` and continue that topic.
    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true, text: 'hi' }));

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(mockSlackBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
  });

  it('continues an existing topic when a subscribed DM follow-up arrives', async () => {
    // After the first DM, chat-sdk's state adapter marks the thread as
    // subscribed; subsequent DMs route to `onSubscribedMessage`, which
    // dispatches through `handleSubscribedMessage` to reuse the cached
    // topicId in chat-sdk thread state.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: false, text: 'follow up' }));

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('routes an unlinked first-touch DM through handleUnlinkedMessage WITHOUT channelMentionThreadId', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: true }));

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    const ctx = mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0];
    expect(ctx.channelMentionThreadId).toBeUndefined();
  });
});

describe('MessengerRouter slash command dispatch', () => {
  // `/agents` reads the user's agents from the live database via
  // `fetchUserAgents` — stub that on the prototype so we don't have to
  // stand up drizzle / the agent table. Other slash tests in this block
  // simply ignore the spy.
  beforeEach(() => {
    vi.spyOn(MessengerRouter.prototype as any, 'fetchUserAgents').mockResolvedValue([
      { id: 'agt_a', title: 'A' },
      { id: 'agt_b', title: 'B' },
    ]);
  });

  const fakeSlashEvent = (overrides: Partial<any> = {}): any => ({
    channel: { id: 'slack:C_GENERAL', isDM: false },
    command: '/agents',
    text: '',
    user: { userId: 'U_ALICE', userName: 'alice' },
    ...overrides,
  });

  it('renders the picker as ephemeral when /agents is invoked from a public channel', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    // `onSlashCommand(paths, handler)` — second arg is the handler.
    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent());

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith('C_GENERAL', {
      entries: expect.any(Array),
      ephemeralTo: 'U_ALICE',
      text: expect.stringContaining('Tap an agent'),
    });
  });

  it('resolves the DM thread for /new slash and clears topicId (slash from DM)', async () => {
    // chat-sdk's slash-event ChannelImpl never carries `isDM=true` (see
    // handleSlashCommand for the workaround). The DM here is detected
    // via the Slack channel-id prefix (`D...`).
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = { id: 'slack:D_DM:', isDM: true, setState: vi.fn() };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeSlashEvent({
        // `isDM: false` mirrors what chat-sdk actually delivers — we
        // detect DM via the channel-id prefix instead.
        channel: { id: 'slack:D_DM', isDM: false },
        command: '/new',
      }),
    );

    expect(mockOpenDM).toHaveBeenCalledWith('U_ALICE');
    expect(dmThread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
    expect(mockSlackBinder.replyPrivately).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Started a new conversation'),
    );
  });

  it('still resolves the DM thread for /new slash fired from a public channel (clears DM topicId)', async () => {
    // Slash from a public channel can't carry a specific thread anchor,
    // so the most useful behavior is to clear the user's canonical bot
    // conversation (the DM) instead of dropping the request. The
    // confirmation is ephemeral so the channel doesn't see it.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    const dmThread = { id: 'slack:D_DM:', isDM: true, setState: vi.fn() };
    mockOpenDM.mockResolvedValue(dmThread);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ command: '/new' })); // default: channel = C_GENERAL

    expect(mockOpenDM).toHaveBeenCalledWith('U_ALICE');
    expect(dmThread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
  });

  it('renders the picker as a regular DM message when /agents is invoked from a DM', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_a',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: true } }));

    expect(mockSlackBinder.sendAgentPicker).toHaveBeenCalledWith('D_DM', {
      entries: expect.any(Array),
      // No ephemeralTo — DMs are private already, picker stays in history.
      ephemeralTo: undefined,
      text: expect.stringContaining('Tap an agent'),
    });
  });

  it('routes /start in a Slack channel through the ephemeral inline link path', async () => {
    // Slack supports `chat.postEphemeral`, so the verify-im link should stay
    // in the channel (invoker-only) instead of bouncing the user out to DM.
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(fakeSlashEvent({ command: '/start' }));

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    const ctx = mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0];
    expect(ctx).toMatchObject({
      authorUserId: 'U_ALICE',
      chatId: 'C_GENERAL',
      channelMentionThreadId: 'slack:C_GENERAL:',
    });
    // No "check your DM" nudge — the link is already inline in the channel.
    expect(mockSlackBinder.replyPrivately).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Check your DM'),
    );
  });

  it('routes /start in a Slack DM through the regular DM link path', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onSlashCommand.mock.calls[0][1] as (event: any) => Promise<void>;
    await handler(
      fakeSlashEvent({ channel: { id: 'slack:D_DM', isDM: false }, command: '/start' }),
    );

    expect(mockSlackBinder.handleUnlinkedMessage).toHaveBeenCalledTimes(1);
    const ctx = mockSlackBinder.handleUnlinkedMessage.mock.calls[0][0];
    expect(ctx).toMatchObject({
      authorUserId: 'U_ALICE',
      chatId: 'D_DM',
      channelMentionThreadId: undefined,
    });
  });
});

describe('MessengerRouter onSubscribedMessage gating', () => {
  it('passes DM follow-ups straight through to handle()', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage({ isMention: false }));

    // Follow-up message on a subscribed DM → handleSubscribedMessage so the
    // cached topicId is reused. (Falls back to handleMention internally if
    // no topicId is cached, but that's a separate path.)
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('responds to a non-mention follow-up while the channel thread is still single-human (LOBE-8981)', async () => {
    // The original @mentioner already counts as participant #1 (tracked
    // in `onNewMention`); when their next post arrives in
    // `onSubscribedMessage` the thread is still 1-human, so the bot should
    // reply without requiring a re-mention.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetList.mockResolvedValue(['U_ALICE']); // alice already tracked

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeChannelThread(), fakeMessage({ isMention: false, text: 'follow up' }));

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockSetIfNotExists).not.toHaveBeenCalledWith(
      expect.stringContaining('mention-required-announced'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('announces mention-only mode and drops the message when a second human joins (LOBE-8981)', async () => {
    // Alice already in the participants list; Bob's first non-mention post
    // pushes count to 2 → bot must announce + skip dispatch.
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE']);
    const thread = fakeChannelThread();

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      thread,
      fakeMessage({
        author: { isBot: false, userId: 'U_BOB', userName: 'bob' },
        isMention: false,
        text: 'taking over',
      }),
    );

    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockAppendToList).toHaveBeenCalledWith(
      'messenger:thread-humans:slack:C_GENERAL:1715000000.000100',
      'U_BOB',
      expect.objectContaining({ maxLength: 50 }),
    );
    expect(mockSetIfNotExists).toHaveBeenCalledWith(
      'messenger:thread-mention-required-announced:slack:C_GENERAL:1715000000.000100',
      '1',
      expect.any(Number),
    );
    expect(thread.post).toHaveBeenCalledWith(expect.stringContaining('@mention me'));
  });

  it('only announces mention-only mode once per channel thread (LOBE-8981)', async () => {
    // Second non-mention in a multi-human thread → `setIfNotExists` returns
    // false, the announcement is suppressed.
    await loadSlackBot();
    mockGetList.mockResolvedValue(['U_ALICE', 'U_BOB']);
    mockSetIfNotExists.mockResolvedValueOnce(false);
    const thread = fakeChannelThread();

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      thread,
      fakeMessage({
        author: { isBot: false, userId: 'U_BOB', userName: 'bob' },
        isMention: false,
        text: 'another non-mention',
      }),
    );

    expect(mockHandleSubscribed).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it('responds to a re-mention in a subscribed channel thread', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      fakeChannelThread(),
      fakeMessage({ isMention: true, text: '<@U_BOT> follow up' }),
    );

    // Subscribed-thread @-mention → handleSubscribedMessage continues the
    // cached topic.
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('responds to a @mention even after multi-human switch (LOBE-8981)', async () => {
    // After the mode switch, a fresh @mention still gets a reply — the
    // gate keys off `isMention || count <= 1`.
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });
    mockGetList.mockResolvedValue(['U_ALICE', 'U_BOB']);

    const handler = mockChatBot.onSubscribedMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(
      fakeChannelThread(),
      fakeMessage({
        author: { isBot: false, userId: 'U_ALICE', userName: 'alice' },
        isMention: true,
        text: '<@U_BOT> please respond',
      }),
    );

    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
  });
});
