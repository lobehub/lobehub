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
// router's bot-load path doesn't actually spin one up.
const mockWebhookHandler = vi.fn(async () => new Response('chat-sdk OK', { status: 200 }));
const mockChatBot = {
  initialize: vi.fn().mockResolvedValue(undefined),
  onAction: vi.fn(),
  onDirectMessage: vi.fn(),
  onNewMention: vi.fn(),
  onSlashCommand: vi.fn(),
  onSubscribedMessage: vi.fn(),
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
// fail to transform in this test env; the router only needs its static
// surface for the /stop command path (not exercised here).
vi.mock('@/server/services/bot/AgentBridgeService', () => ({
  AgentBridgeService: class {
    static clearActiveThread = vi.fn();
    static getActiveOperationId = vi.fn();
    static isThreadActive = vi.fn();
    static requestStop = vi.fn();
    handleMention = vi.fn();
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
// without hitting any platform SDK.
vi.mock('./platforms/slack/binder', () => ({
  MessengerSlackBinder: vi.fn().mockImplementation(() => ({
    createClient: () => ({
      createAdapter: () => ({}),
      extractChatId: (id: string) => id,
      registerBotCommands: undefined,
    }),
    extractCallbackAction: undefined,
    handleUnlinkedMessage: vi.fn(),
    notifyLinkSuccess: vi.fn(),
    registerWebhook: vi.fn(),
    sendDmText: vi.fn(),
  })),
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
