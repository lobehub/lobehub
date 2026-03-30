import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWechatAdapter = vi.hoisted(() => vi.fn());
const mockGetUpdates = vi.hoisted(() => vi.fn());
const mockStartTyping = vi.hoisted(() => vi.fn());
const MessageState = vi.hoisted(() => ({ FINISH: 2 }));
const MessageType = vi.hoisted(() => ({ BOT: 2, USER: 1 }));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  createWechatAdapter: mockCreateWechatAdapter,
  MessageState,
  MessageType,
  WechatApiClient: vi.fn().mockImplementation(() => ({
    getUpdates: mockGetUpdates,
    startTyping: mockStartTyping,
  })),
}));

const { WechatClientFactory } = await import('./client');

describe('WechatGatewayClient', () => {
  const runtimeRedis = {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    runtimeRedis.get.mockResolvedValue(null);
    runtimeRedis.set.mockResolvedValue('OK');
    runtimeRedis.del.mockResolvedValue(1);
  });

  it('waits for the initial readiness probe before resolving start', async () => {
    let resolveProbe: ((value: any) => void) | undefined;
    let resolveLoop: ((value: any) => void) | undefined;

    mockGetUpdates
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
      )
      .mockImplementationOnce(
        (_cursor?: string, signal?: AbortSignal) =>
          new Promise((resolve, reject) => {
            resolveLoop = resolve;
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

    const client = new WechatClientFactory().createClient(
      {
        applicationId: 'wechat-app',
        credentials: { botId: 'bot-id', botToken: 'bot-token' },
        platform: 'wechat',
        settings: {},
      },
      { appUrl: 'https://example.com', redisClient: runtimeRedis as any },
    );

    const backgroundTasks: Promise<any>[] = [];
    let started = false;
    const startPromise = client.start({
      waitUntil: (task: Promise<any>) => {
        backgroundTasks.push(task.catch(() => {}));
      },
    });
    void startPromise.then(() => {
      started = true;
    });

    for (const _ of Array.from({ length: 10 })) {
      if (resolveProbe) break;
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    expect(resolveProbe).toBeTypeOf('function');
    expect(started).toBe(false);

    resolveProbe?.({ get_updates_buf: 'cursor-1', msgs: [], ret: 0 });
    await startPromise;

    expect(mockGetUpdates).toHaveBeenNthCalledWith(1, undefined, expect.any(AbortSignal));
    expect(mockGetUpdates).toHaveBeenNthCalledWith(2, 'cursor-1', expect.any(AbortSignal));

    await client.stop();
    resolveLoop?.({ get_updates_buf: 'cursor-1', msgs: [], ret: 0 });
    await Promise.all(backgroundTasks);
  });

  it('forwards messages received during the readiness probe', async () => {
    let resolveLoop: ((value: any) => void) | undefined;

    mockGetUpdates
      .mockResolvedValueOnce({
        get_updates_buf: 'cursor-1',
        msgs: [
          {
            context_token: 'ctx-1',
            create_time_ms: Date.now(),
            from_user_id: 'user-1@im.wechat',
            item_list: [],
            message_id: 1,
            message_state: MessageState.FINISH,
            message_type: MessageType.USER,
            to_user_id: 'bot-id',
          },
        ],
        ret: 0,
      })
      .mockImplementationOnce(
        (_cursor?: string, signal?: AbortSignal) =>
          new Promise((resolve, reject) => {
            resolveLoop = resolve;
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

    const fetchMock = vi.mocked(fetch);
    const client = new WechatClientFactory().createClient(
      {
        applicationId: 'wechat-app',
        credentials: { botId: 'bot-id', botToken: 'bot-token' },
        platform: 'wechat',
        settings: {},
      },
      { appUrl: 'https://example.com', redisClient: runtimeRedis as any },
    );

    const backgroundTasks: Promise<any>[] = [];
    await client.start({
      waitUntil: (task: Promise<any>) => {
        backgroundTasks.push(task.catch(() => {}));
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/agent/webhooks/wechat/wechat-app',
      expect.objectContaining({
        body: expect.stringContaining('"from_user_id":"user-1@im.wechat"'),
        method: 'POST',
      }),
    );

    await client.stop();
    resolveLoop?.({ get_updates_buf: 'cursor-1', msgs: [], ret: 0 });
    await Promise.all(backgroundTasks);
  });

  it('throws a readable error when bot token is missing', () => {
    expect(() =>
      new WechatClientFactory().createClient(
        {
          applicationId: 'wechat-app',
          credentials: {},
          platform: 'wechat',
          settings: {},
        },
        { appUrl: 'https://example.com', redisClient: runtimeRedis as any },
      ),
    ).toThrowError('Bot Token is required');
  });
});
