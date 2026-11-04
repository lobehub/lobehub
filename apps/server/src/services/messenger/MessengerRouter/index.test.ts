// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessengerRouter } from './index';
import {
  buildSlackRequest,
  fakeDmThread,
  fakeMessage,
  fakeWechatDmThread,
  loadSlackBot,
  loadWechatBot,
  mockChatBot,
  mockFindLink,
  mockHandleMention,
  mockHandleSubscribed,
  mockLinqGate,
  mockMarkRevoked,
  mockResolveByPayload,
  mockSetIfNotExists,
  mockSlackBinder,
  mockVerifySignature,
  mockWebhookHandler,
  resetMessengerRouterMocks,
  slackCreds,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).agentRuntimeRedisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/gateway', async () => (await import('./testUtils')).gatewayEnvModule());
vi.mock('../installations', async () => (await import('./testUtils')).installationsModule());
vi.mock('../oauth/slackOAuth', async () => (await import('./testUtils')).slackOAuthModule());
vi.mock('@/server/featureFlags', async () => (await import('./testUtils')).featureFlagsModule());
vi.mock('@/config/messenger', async () => (await import('./testUtils')).messengerConfigModule());
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('@/server/services/bot/AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('@/database/models/agent', async () => (await import('./testUtils')).agentModelModule());
vi.mock('@/database/models/messengerAccountLink', async () =>
  (await import('./testUtils')).messengerAccountLinkModule(),
);
vi.mock('@/database/models/workspace', async () =>
  (await import('./testUtils')).workspaceModelModule(),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('@/database/models/workspaceUserSettings', async () =>
  (await import('./testUtils')).workspaceUserSettingsModule(),
);
vi.mock('@/server/services/resourcePermission', async () =>
  (await import('./testUtils')).resourcePermissionModule(),
);
vi.mock('@/server/services/bot/replyTemplate', async () =>
  (await import('./testUtils')).replyTemplateModule(),
);
vi.mock('../platforms/slack/binder', async () => (await import('./testUtils')).slackBinderModule());
vi.mock('../platforms/telegram/binder', async () =>
  (await import('./testUtils')).telegramBinderModule(),
);
vi.mock('../platforms/wechat/binder', async () =>
  (await import('./testUtils')).wechatBinderModule(),
);
vi.mock('../platforms/linq/binder', async () => (await import('./testUtils')).linqBinderModule());
vi.mock('../platforms/linq/webhook', async () => (await import('./testUtils')).linqWebhookModule());

beforeEach(() => {
  resetMessengerRouterMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerRouter.getWebhookHandler', () => {
  it('lets the gate settle a delivery whose handling failed', async () => {
    mockResolveByPayload.mockResolvedValueOnce(null);
    const router = new MessengerRouter();
    const req = new Request('https://e.com/x', { body: '{}', method: 'POST' });

    const res = await router.getWebhookHandler('linq')(req);

    expect(res.status).toBe(404);
    expect(mockLinqGate.settle).toHaveBeenCalledWith(req, res);
  });

  it('lets the gate settle a delivery whose handling threw', async () => {
    mockResolveByPayload.mockRejectedValueOnce(new Error('db down'));
    const router = new MessengerRouter();
    const req = new Request('https://e.com/x', { body: '{}', method: 'POST' });

    await expect(router.getWebhookHandler('linq')(req)).rejects.toThrow('db down');
    expect(mockLinqGate.settle).toHaveBeenCalledWith(req, undefined);
  });

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
    const options = { waitUntil: vi.fn() };
    const res = await router.getWebhookHandler('slack')(buildSlackRequest(body), options);
    expect(res.status).toBe(200);
    expect(mockWebhookHandler).toHaveBeenCalledTimes(1);
    // Reconstructed request preserves the body (raw bytes are still readable).
    const calls = mockWebhookHandler.mock.calls as unknown as Array<[Request, typeof options]>;
    const passedReq = calls[0][0];
    expect(await passedReq.text()).toBe(body);
    expect(calls[0][1]).toBe(options);
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

describe('MessengerRouter collected commands', () => {
  it.each([
    ['/new', 'question'],
    ['question', '/new'],
  ])('preserves command and content order for %s then %s', async (first, second) => {
    const events: string[] = [];
    const thread = {
      ...fakeWechatDmThread(),
      state: Promise.resolve({ topicId: 'old-topic' }),
      setState: vi.fn(async () => {
        events.push('reset');
      }),
    };
    mockFindLink.mockResolvedValue({
      activeAgentId: 'agt_main',
      id: 'link',
      platformUserId: 'U_ALICE',
      userId: 'user_alice',
    });
    mockHandleSubscribed.mockImplementation(async (_thread, message) => {
      events.push(message.text);
    });
    mockChatBot.dispatchToHandlers = vi.fn(async (_adapter, _threadId, message, context) => {
      const handler = mockChatBot.onSubscribedMessage.mock.calls.at(-1)![0];
      await handler(thread, message, context);
    });
    await loadWechatBot();
    await mockChatBot.dispatchToHandlers({}, thread.id, fakeMessage({ text: second }), {
      skipped: [fakeMessage({ text: first })],
      totalSinceLastHandler: 2,
    });
    expect(events).toEqual([first, second].map((text) => (text === '/new' ? 'reset' : text)));
    expect(thread.setState).toHaveBeenCalledTimes(1);
    expect(mockHandleSubscribed).toHaveBeenCalledTimes(1);
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

  it('replies with an error instead of dropping the message when the link lookup fails', async () => {
    // Handlers run after the webhook was acknowledged, so the platform never
    // redelivers; a failure here has to reach the sender as a reply.
    await loadSlackBot();
    mockFindLink.mockRejectedValueOnce(new Error('db down'));

    const handler = mockChatBot.onNewMention.mock.calls[0][0] as (
      thread: any,
      msg: any,
    ) => Promise<void>;
    const thread = fakeDmThread();
    await expect(handler(thread, fakeMessage({ isMention: true }))).resolves.toBeUndefined();

    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(mockSlackBinder.handleUnlinkedMessage).not.toHaveBeenCalled();
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
