// @vitest-environment node
import { signCallback } from '@lobechat/chat-adapter-dingtalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { platformRegistry } from '../platforms';
import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockAgentBridgeServiceCtor,
  mockFindEnabledByPlatform,
  mockGetAgentRuntimeRedisClient,
  mockHandleMention,
  mockHandleSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';

/**
 * Mock-DingTalk acceptance for the inbound → agent → outbound chain.
 *
 * Real: `chat` SDK, `@lobechat/chat-adapter-dingtalk` (signature check,
 * single / group parsing, thread ids, sessionWebhook-first send), the DingTalk
 * platform definition and client from the shared `platformRegistry`, and
 * `BotMessageRouter` (on-demand bot load, access gates, mention / subscribed
 * routing into `AgentBridgeService`).
 * Faked: DingTalk itself (`globalThis.fetch`), the provider row, and
 * `AgentBridgeService` — its `handleMention` stands in for the agent run and
 * posts the reply the way each runtime does: `thread.post` (local mode) and
 * `PlatformMessenger.createMessage` (gateway mode, what `BotCallbackService`
 * calls when the agent gateway reports completion).
 */

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'http://localhost:3010', INTERNAL_APP_URL: '' },
}));
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('@/server/services/agentSignal', () => ({ emitAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({ general: { timezone: 'UTC' } }) };
  }),
}));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus: vi.fn(),
}));

/**
 * The router only builds chat SDK state when a Redis client exists, so the
 * test hands it a placeholder client and swaps the ioredis state for memory.
 */
const chatState = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('@chat-adapter/state-ioredis', () => ({
  createIoRedisState: () => chatState.current,
}));

/** In-memory stand-in for the `bot-reply` Redis scope. */
const replyRoutes = vi.hoisted(() => new Map<string, { expiresAt: number; url: string }>());
vi.mock('@/server/services/redis', () => ({
  redisService: {
    // Bot-wake bookkeeping is best effort and not under test here.
    botWake: new Proxy({}, { get: () => async () => undefined }),
    botReply: {
      forgetDingTalkSessionWebhook: async (app: string, thread: string) => {
        replyRoutes.delete(`${app}:${thread}`);
      },
      getDingTalkSessionWebhook: async (app: string, thread: string) =>
        replyRoutes.get(`${app}:${thread}`),
      rememberDingTalkSessionWebhook: async (
        app: string,
        thread: string,
        webhook: { expiresAt: number; url: string },
      ) => {
        replyRoutes.set(`${app}:${thread}`, webhook);
      },
    },
  },
}));

/** Minimal in-memory `StateAdapter` (same shape as chatSdkContract.test.ts). */
const createMemoryState = ({ exclusiveLocks = false }: { exclusiveLocks?: boolean } = {}) => {
  const heldLocks = new Set<string>();
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const subscribed = new Set<string>();
  const queues = new Map<string, unknown[]>();
  return {
    acquireLock: async (threadId: string) => {
      if (exclusiveLocks) {
        if (heldLocks.has(threadId)) return null;
        heldLocks.add(threadId);
      }
      return { expiresAt: Number.MAX_SAFE_INTEGER, threadId, token: 'token' };
    },
    appendToList: async (key: string, value: unknown) => {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    connect: async () => {},
    delete: async (key: string) => {
      values.delete(key);
    },
    dequeue: async (threadId: string) => queues.get(threadId)?.shift() ?? null,
    disconnect: async () => {},
    enqueue: async (threadId: string, entry: unknown) => {
      const queue = queues.get(threadId) ?? [];
      // Redis stores JSON; structuredClone would preserve fields that Message.toJSON drops.
      // eslint-disable-next-line unicorn/prefer-structured-clone
      queue.push(JSON.parse(JSON.stringify(entry)));
      queues.set(threadId, queue);
      return queue.length;
    },
    extendLock: async () => true,
    forceReleaseLock: async () => {},
    get: async (key: string) => values.get(key) ?? null,
    getList: async (key: string) => lists.get(key) ?? [],
    isSubscribed: async (threadId: string) => subscribed.has(threadId),
    queueDepth: async (threadId: string) => queues.get(threadId)?.length ?? 0,
    releaseLock: async (lock?: { threadId: string }) => {
      if (lock) heldLocks.delete(lock.threadId);
    },
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    setIfNotExists: async (key: string, value: unknown) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    subscribe: async (threadId: string) => {
      subscribed.add(threadId);
    },
    unsubscribe: async (threadId: string) => {
      subscribed.delete(threadId);
    },
  };
};

// ---------------------------------------------------------------- mock DingTalk
const APP_ID = 'dingmockapp';
const SECRET = 'mock-client-secret';
const BOT_ID = '$:LWCP_v1:$bot';
const STAFF = 'manager1234';
const GROUP = 'cidMockGroup==';

interface DingTalkCall {
  body: any;
  url: string;
}

const dingtalk = {
  calls: [] as DingTalkCall[],
  /** sessionWebhook URLs DingTalk will reject (expired session). */
  expiredSessions: new Set<string>(),
};

const installMockDingTalk = () => {
  vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    dingtalk.calls.push({ body, url });

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
        status,
      });

    if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
      return body?.appKey === APP_ID && body?.appSecret === SECRET
        ? json(200, { accessToken: 'mock-token', expireIn: 7200 })
        : json(400, { code: 'invalidClientSecret', message: 'bad secret' });
    }
    if (url === 'https://api.dingtalk.com/v1.0/robot/groupMessages/send') {
      return json(200, { processQueryKey: `group-${dingtalk.calls.length}` });
    }
    if (url === 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend') {
      return json(200, {
        flowControlledStaffIdList: [],
        invalidStaffIdList: [],
        processQueryKey: `single-${dingtalk.calls.length}`,
      });
    }
    if (url.startsWith('https://oapi.dingtalk.com/robot/sendBySession')) {
      return dingtalk.expiredSessions.has(url)
        ? json(200, { errcode: 300_001, errmsg: 'session expired' })
        : json(200, { errcode: 0, errmsg: 'ok' });
    }
    throw new Error(`mock dingtalk: unexpected outbound request ${url}`);
  });
};

let msgSeq = 0;

/** A robot callback, signed the way the Stream gateway forwards it to the webhook. */
const callback = (overrides: Record<string, unknown>) => {
  msgSeq += 1;
  const payload = {
    chatbotCorpId: 'dingCorp',
    chatbotUserId: BOT_ID,
    conversationId: 'cidSingle==',
    conversationType: '1',
    createAt: Date.now(),
    isInAtList: false,
    msgId: `msg-${msgSeq}`,
    msgtype: 'text',
    robotCode: APP_ID,
    senderCorpId: 'dingCorp',
    senderId: '$:LWCP_v1:$user',
    senderNick: '张三',
    senderStaffId: STAFF,
    sessionWebhook: `https://oapi.dingtalk.com/robot/sendBySession?session=s${msgSeq}`,
    sessionWebhookExpiredTime: Date.now() + 90 * 60 * 1000,
    text: { content: '你好' },
    ...overrides,
  };
  const timestamp = String(Date.now());
  return {
    payload,
    request: new Request(`http://localhost:3010/api/agent/webhooks/dingtalk/${APP_ID}`, {
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        'sign': signCallback(timestamp, SECRET),
        timestamp,
      },
      method: 'POST',
    }),
  };
};

const waitFor = async (assertion: () => void, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
};

/** The reply the gateway-mode bot callback sends: `client.getMessenger(threadId).createMessage`. */
const postGatewayReply = (platformThreadId: string, text: string) =>
  platformRegistry
    .createClient('dingtalk', {
      applicationId: APP_ID,
      credentials: { clientSecret: SECRET },
      platform: 'dingtalk',
      settings: {},
    })
    .getMessenger(platformThreadId)
    .createMessage(text);

const sendsTo = (prefix: string) => dingtalk.calls.filter((c) => c.url.startsWith(prefix));

describe('mock DingTalk callback drives the real router into the agent bridge and back', () => {
  let router: BotMessageRouter;
  let webhook: (req: Request) => Promise<Response>;

  beforeEach(() => {
    resetBotMessageRouterMocks();
    chatState.current = createMemoryState();
    mockGetAgentRuntimeRedisClient.mockReturnValue({
      get: async () => null,
      set: async () => 'OK',
    });
    replyRoutes.clear();
    dingtalk.calls = [];
    dingtalk.expiredSessions.clear();
    installMockDingTalk();
    mockFindEnabledByPlatform.mockResolvedValue([
      makeProvider({
        agentId: 'agent-dingtalk',
        applicationId: APP_ID,
        credentials: { clientSecret: SECRET },
        id: 'provider-dingtalk',
        platform: 'dingtalk',
        settings: { dmPolicy: 'open', groupPolicy: 'open' },
        userId: 'user-dingtalk',
      }),
    ]);
    router = new BotMessageRouter();
    webhook = router.getWebhookHandler('dingtalk', APP_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an unsigned callback before any agent work', async () => {
    const { payload } = callback({});
    const response = await webhook(
      new Request(`http://localhost:3010/api/agent/webhooks/dingtalk/${APP_ID}`, {
        body: JSON.stringify(payload),
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(mockHandleMention).not.toHaveBeenCalled();
  });

  it('single chat: routes the DM to the agent, then replies into the same chat', async () => {
    mockHandleMention.mockImplementationOnce(async (thread: any) => {
      await thread.subscribe();
      // Local runtime: the bridge posts through the chat SDK thread → adapter.
      await thread.post({ markdown: '**结论**：可以' });
    });

    const { payload, request } = callback({ text: { content: ' 帮我总结一下' } });
    const response = await webhook(request);
    expect(response.status).toBe(200);

    await waitFor(() => expect(mockHandleMention).toHaveBeenCalledTimes(1));
    const [thread, message, options] = mockHandleMention.mock.calls[0];
    expect(mockAgentBridgeServiceCtor).toHaveBeenCalled();
    expect(thread.id).toBe(`dingtalk:single:${STAFF}`);
    expect(thread.isDM).toBe(true);
    expect(message.text).toBe('帮我总结一下');
    expect(message.author).toMatchObject({ userId: STAFF, userName: '张三' });
    expect(options).toMatchObject({
      agentId: 'agent-dingtalk',
      botContext: expect.objectContaining({
        applicationId: APP_ID,
        platform: 'dingtalk',
        platformThreadId: `dingtalk:single:${STAFF}`,
      }),
    });

    // Local-mode reply used the callback's sessionWebhook.
    await waitFor(() => expect(sendsTo(payload.sessionWebhook)).toHaveLength(1));
    expect(sendsTo(payload.sessionWebhook)[0].body).toMatchObject({
      markdown: { text: '**结论**：可以' },
      msgtype: 'markdown',
    });

    // Gateway-mode reply (BotCallbackService → messenger) finds the same route in Redis.
    await postGatewayReply(`dingtalk:single:${STAFF}`, 'done');
    expect(sendsTo(payload.sessionWebhook)).toHaveLength(2);
    expect(sendsTo(payload.sessionWebhook)[1].body).toMatchObject({
      msgtype: 'text',
      text: { content: 'done' },
    });

    // Once the session expires, the reply falls back to oToMessages/batchSend for this staff id.
    dingtalk.expiredSessions.add(payload.sessionWebhook);
    await postGatewayReply(`dingtalk:single:${STAFF}`, 'after expiry');
    const batch = sendsTo('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend');
    expect(batch).toHaveLength(1);
    expect(batch[0].body).toMatchObject({
      msgKey: 'sampleText',
      robotCode: APP_ID,
      userIds: [STAFF],
    });
    expect(JSON.parse(batch[0].body.msgParam)).toEqual({ content: 'after expiry' });

    // The follow-up in the now-subscribed DM reuses the conversation (no new mention).
    const followUp = callback({ text: { content: '继续' } });
    await webhook(followUp.request);
    await waitFor(() => expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1));
    const [sameThread, followUpMessage] = mockHandleSubscribedMessage.mock.calls[0];
    expect(sameThread.id).toBe(`dingtalk:single:${STAFF}`);
    expect(followUpMessage.text).toBe('继续');
    expect(mockHandleMention).toHaveBeenCalledTimes(1);
  });

  it('group chat: routes the @-mention to the agent, then replies into the group', async () => {
    mockHandleMention.mockImplementationOnce(async (thread: any) => {
      await thread.post('收到');
    });

    const { payload, request } = callback({
      atUsers: [{ dingtalkId: BOT_ID }],
      conversationId: GROUP,
      conversationTitle: '研发群',
      conversationType: '2',
      isInAtList: true,
      text: { content: ' 部署好了吗' },
    });
    await webhook(request);

    await waitFor(() => expect(mockHandleMention).toHaveBeenCalledTimes(1));
    const [thread, message, options] = mockHandleMention.mock.calls[0];
    expect(thread.id).toBe(`dingtalk:group:${GROUP}`);
    expect(thread.isDM).toBe(false);
    expect(message.isMention).toBe(true);
    expect(message.text).toBe('部署好了吗');
    expect(options.botContext).toMatchObject({
      platform: 'dingtalk',
      platformThreadId: `dingtalk:group:${GROUP}`,
    });

    await waitFor(() => expect(sendsTo(payload.sessionWebhook)).toHaveLength(1));
    expect(sendsTo(payload.sessionWebhook)[0].body).toMatchObject({
      msgtype: 'text',
      text: { content: '收到' },
    });

    // Without a live session route, the gateway-mode reply goes to groupMessages/send.
    replyRoutes.clear();
    await postGatewayReply(`dingtalk:group:${GROUP}`, '## 部署完成\n- web: ok');
    const group = sendsTo('https://api.dingtalk.com/v1.0/robot/groupMessages/send');
    expect(group).toHaveLength(1);
    expect(group[0].body).toMatchObject({
      msgKey: 'sampleMarkdown',
      openConversationId: GROUP,
      robotCode: APP_ID,
    });
    expect(JSON.parse(group[0].body.msgParam)).toEqual({
      text: '## 部署完成\n- web: ok',
      title: '部署完成',
    });
    expect(
      dingtalk.calls.some((c) => c.url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken'),
    ).toBe(true);
  });

  it('ignores the robot’s own messages', async () => {
    const { request } = callback({ senderId: BOT_ID });
    await webhook(request);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockHandleMention).not.toHaveBeenCalled();
    expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
  });
});
