/**
 * #23215 across every platform that holds a persistent connection and hands
 * inbound events to its own webhook route: the loopback goes through
 * INTERNAL_APP_URL when set (else the public app URL), and a forward that
 * fails is logged at error level and marks the bot failed. Telegram registers
 * a URL that Telegram itself calls, so it keeps the public APP_URL.
 *
 * Each client is the real one; only its transport (socket / SDK / poller) is
 * stubbed, and the stub captures what the client wired into it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  /** Make the transport report one failed forward, the way it would on ECONNREFUSED. */
  fail: () => Promise<unknown> | unknown;
  webhookUrl: string;
}

const h = vi.hoisted(() => ({
  appEnv: { APP_URL: undefined, INTERNAL_APP_URL: undefined } as Record<string, string | undefined>,
  captured: new Map<string, Captured>(),
  refused: () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
  updateBotRuntimeStatus: vi.fn(),
}));

vi.mock('@/envs/app', () => ({ appEnv: h.appEnv }));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    queued: 'queued',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => (e ? String(e?.message ?? e) : undefined),
  updateBotRuntimeStatus: h.updateBotRuntimeStatus,
}));

vi.mock('chat', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class FakeChat {
    adapters: Map<string, any>;
    initialize = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);
    constructor(config: any) {
      this.adapters = new Map(Object.entries(config.adapters));
    }
  }
  return { ...actual, Chat: FakeChat };
});

// --- Transports, one per platform ---

/** QQ / DingTalk adapters run the socket themselves and report through `onForwardResult`. */
const gatewayListenerAdapter = (platform: string) => ({
  handleWebhook: vi.fn(),
  startGatewayListener: vi.fn(
    async (options: any, _duration: number, _signal: any, url: string) => {
      h.captured.set(platform, {
        fail: () => options.onForwardResult({ error: h.refused(), ok: false }),
        webhookUrl: url,
      });
    },
  ),
});

vi.mock('../feishu/gateway', () => ({
  FeishuWSConnection: class {
    constructor(options: any) {
      h.captured.set(options.domain, {
        fail: () => options.onForwardResult({ error: h.refused(), ok: false }),
        webhookUrl: options.webhookUrl,
      });
    }
    close() {}
    async start() {}
  },
}));

vi.mock('@lobechat/chat-adapter-feishu', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLarkAdapter: () => ({}),
}));

vi.mock('../slack/gateway', () => ({
  SlackSocketModeConnection: class {
    constructor(options: any) {
      h.captured.set('slack', {
        fail: () => options.onForwardResult({ error: h.refused(), ok: false }),
        webhookUrl: options.webhookUrl,
      });
    }
    close() {}
    async connect() {}
  },
}));

vi.mock('@chat-adapter/slack', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSlackAdapter: () => ({}),
}));

vi.mock('@lobechat/chat-adapter-qq', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createQQAdapter: () => gatewayListenerAdapter('qq'),
}));

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDingTalkAdapter: () => gatewayListenerAdapter('dingtalk'),
}));

// Discord: the library's own `forwardGatewayEvent` is replaced by our patch, so
// the failure goes through the real patched method and a real (stubbed) fetch.
vi.mock('@chat-adapter/discord', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createDiscordAdapter: () => {
    const adapter: any = {
      forwardGatewayEvent: async () => {},
      resolveBotToken: async () => 'discord-token',
      startGatewayListener: vi.fn(async (_options: any, _d: number, _s: any, url: string) => {
        h.captured.set('discord', {
          fail: () => {
            vi.mocked(fetch).mockRejectedValueOnce(h.refused());
            return adapter.forwardGatewayEvent(url, { type: 'GATEWAY_MESSAGE_CREATE' });
          },
          webhookUrl: url,
        });
      }),
    };
    return adapter;
  },
}));

vi.mock('@lobechat/chat-adapter-wecom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerWeComConnection: () => {},
  unregisterWeComConnection: () => {},
  WeComLongConnection: class {
    constructor(options: any) {
      h.captured.set('wecom', {
        fail: () => options.onForwardResult({ error: h.refused(), ok: false }),
        webhookUrl: options.webhookUrl,
      });
    }
    async start() {}
    stop() {}
  },
}));

// WeChat long-polls: the first poll returns one message, which the real client
// forwards with `fetch`; later polls wait until the client stops.
vi.mock('@lobechat/chat-adapter-wechat', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  let polls = 0;
  return {
    ...actual,
    WechatApiClient: class {
      async getUpdates(_cursor?: string, signal?: AbortSignal) {
        polls += 1;
        if (polls % 2 === 1) {
          return {
            get_updates_buf: 'cursor-1',
            msgs: [
              {
                context_token: 'ctx-1',
                from_user_id: 'user-1@im.wechat',
                item_list: [],
                message_id: polls,
                message_state: actual.MessageState.FINISH,
                message_type: actual.MessageType.USER,
                to_user_id: 'bot-id',
              },
            ],
            ret: 0,
          };
        }
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
    },
  };
});

const { platformRegistry } = await import('../index');

const PUBLIC_URL = 'https://lobe.tailnet.example';
const INTERNAL_URL = 'http://localhost:3210';

const PLATFORMS = [
  {
    applicationId: 'cli_feishu',
    credentials: { appSecret: 'secret' },
    platform: 'feishu',
    settings: { connectionMode: 'websocket' },
  },
  {
    applicationId: 'cli_lark',
    credentials: { appSecret: 'secret' },
    platform: 'lark',
    settings: { connectionMode: 'websocket' },
  },
  {
    applicationId: 'A_SLACK',
    credentials: { appToken: 'xapp-1', botToken: 'xoxb-1', signingSecret: 'secret' },
    platform: 'slack',
    settings: { connectionMode: 'websocket' },
  },
  {
    applicationId: '102400',
    credentials: { appSecret: 'secret' },
    platform: 'qq',
    settings: { connectionMode: 'websocket' },
  },
  {
    applicationId: '9000000001',
    credentials: { botToken: 'discord-token', publicKey: 'pk' },
    platform: 'discord',
    settings: {},
  },
  {
    applicationId: 'ding_app',
    credentials: { clientSecret: 'secret' },
    platform: 'dingtalk',
    settings: { connectionMode: 'websocket' },
  },
  {
    applicationId: 'wx_app',
    credentials: { botId: 'bot-id', botToken: 'wechat-token' },
    platform: 'wechat',
    settings: {},
  },
  {
    applicationId: 'wecom_bot',
    credentials: { secret: 'secret' },
    platform: 'wecom',
    settings: {},
  },
] as const;

const clients: { stop: () => Promise<void> }[] = [];

const startClient = async (config: (typeof PLATFORMS)[number]) => {
  const client = platformRegistry
    .getPlatform(config.platform)!
    .clientFactory.createClient(
      { ...config, credentials: { ...config.credentials }, settings: { ...config.settings } },
      { appUrl: PUBLIC_URL },
    );
  clients.push(client);
  await client.start({ durationMs: 60_000, waitUntil: () => {} } as any);
  return client;
};

/** WeChat forwards from inside its poll loop; the others hand the URL to a transport. */
const forwardedUrl = (platform: string): string | undefined => {
  if (platform !== 'wechat') return h.captured.get(platform)?.webhookUrl;
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).includes('/api/agent/webhooks/wechat/'));
  return call ? String(call[0]) : undefined;
};

beforeEach(() => {
  h.captured.clear();
  h.updateBotRuntimeStatus.mockReset().mockResolvedValue(undefined);
  h.appEnv.APP_URL = PUBLIC_URL;
  h.appEnv.INTERNAL_APP_URL = undefined;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop().catch(() => {})));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('persistent-connection loopback URL', () => {
  it.each(PLATFORMS)(
    '$platform forwards inbound events through INTERNAL_APP_URL when it is set',
    async (config) => {
      h.appEnv.INTERNAL_APP_URL = INTERNAL_URL;

      await startClient(config);

      expect(forwardedUrl(config.platform)).toBe(
        `${INTERNAL_URL}/api/agent/webhooks/${config.platform}/${config.applicationId}`,
      );
    },
  );

  it.each(PLATFORMS)(
    '$platform falls back to the public APP_URL without INTERNAL_APP_URL',
    async (config) => {
      await startClient(config);

      expect(forwardedUrl(config.platform)).toBe(
        `${PUBLIC_URL}/api/agent/webhooks/${config.platform}/${config.applicationId}`,
      );
    },
  );

  it('Telegram registers its webhook on the public APP_URL even when INTERNAL_APP_URL is set', async () => {
    h.appEnv.INTERNAL_APP_URL = INTERNAL_URL;
    const client = platformRegistry.getPlatform('telegram')!.clientFactory.createClient(
      {
        applicationId: '8654315085',
        credentials: { botToken: 'telegram-token' },
        platform: 'telegram',
        settings: {},
      },
      { appUrl: PUBLIC_URL },
    );

    await client.start();

    const setWebhook = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/setWebhook'));
    // Telegram calls this URL from the internet; the path key is the bot token.
    expect(JSON.parse(String((setWebhook![1] as RequestInit).body)).url).toBe(
      `${PUBLIC_URL}/api/agent/webhooks/telegram/telegram-token`,
    );
  });
});

describe('persistent-connection forward failures', () => {
  it.each(PLATFORMS)(
    '$platform logs a dropped inbound event at error level and marks the bot failed',
    async (config) => {
      if (config.platform === 'wechat') {
        // The poller forwards the message it receives while starting.
        vi.mocked(fetch).mockRejectedValueOnce(h.refused());
      }
      await startClient(config);
      if (config.platform !== 'wechat') await h.captured.get(config.platform)!.fail();

      await vi.waitFor(() =>
        expect(h.updateBotRuntimeStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            applicationId: config.applicationId,
            errorCode: 'inbound_forward_failed',
            platform: config.platform,
            status: 'failed',
          }),
          expect.anything(),
        ),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `[bot-platform:${config.platform}] Dropped an inbound event for ${config.applicationId}`,
        ),
      );
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('(ECONNREFUSED)'));
      // The status a reader gets afterwards: the client's own `connected` write
      // must not land on top (WeChat drops the message during its readiness probe).
      const writes = h.updateBotRuntimeStatus.mock.calls
        .map(([params]) => params)
        .filter((params) => params.applicationId === config.applicationId);
      expect(writes.at(-1)).toMatchObject({
        errorCode: 'inbound_forward_failed',
        status: 'failed',
      });
    },
  );
});
