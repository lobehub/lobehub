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
const mockChatBot = {
  initialize: vi.fn().mockResolvedValue(undefined),
  onAction: vi.fn(),
  onDirectMessage: vi.fn(),
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
// instance + every `handleMention` call on the static so tests can assert
// the linked-user dispatch path fired without instantiating the real
// agent runtime.
const mockHandleMention = vi.fn();
vi.mock('@/server/services/bot/AgentBridgeService', () => ({
  AgentBridgeService: class {
    static clearActiveThread = vi.fn();
    static getActiveOperationId = vi.fn();
    static isThreadActive = vi.fn();
    static requestStop = vi.fn();
    handleMention = mockHandleMention;
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
  mockOpenDM.mockReset();
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
// `bot.onNewMention` / `onSubscribedMessage` / `onDirectMessage`. We trigger
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
    // thread_ts on the underlying chat.postMessage).
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockHandleMention.mock.calls[0][2]).toMatchObject({ agentId: 'agt_main' });
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

describe('MessengerRouter DM dispatch (regression)', () => {
  it('dispatches a linked DM message to the active agent and subscribes the thread', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link_1',
      platformUserId: 'U_ALICE',
      tenantId: 'T_ACME',
      userId: 'user_alice',
    });

    const handler = mockChatBot.onDirectMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const thread = fakeDmThread();
    await handler(thread, fakeMessage({ text: 'hi' }));

    expect(thread.subscribe).toHaveBeenCalledTimes(1);
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
  });

  it('routes an unlinked DM through handleUnlinkedMessage WITHOUT channelMentionThreadId', async () => {
    await loadSlackBot();
    mockFindLink.mockResolvedValue(null);

    const handler = mockChatBot.onDirectMessage.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    await handler(fakeDmThread(), fakeMessage());

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

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });

  it('drops a non-mention follow-up in a subscribed channel thread', async () => {
    await loadSlackBot();
    // findLink should never be reached because the gate fires first.
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
    await handler(fakeChannelThread(), fakeMessage({ isMention: false, text: 'random chatter' }));

    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockFindLink).not.toHaveBeenCalled();
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

    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });
});
