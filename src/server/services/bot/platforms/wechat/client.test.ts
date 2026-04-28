import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWechatAdapter = vi.hoisted(() => vi.fn());
const mockGetUpdates = vi.hoisted(() => vi.fn());
const mockStartTyping = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const MessageState = vi.hoisted(() => ({ FINISH: 2 }));
const MessageType = vi.hoisted(() => ({ BOT: 2, USER: 1 }));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  createWechatAdapter: mockCreateWechatAdapter,
  downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
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

  describe('extractFiles', () => {
    // Verifies the post-Redis re-download path: when WeChat messages
    // round-trip through the chat-sdk debounce/queue, `Message.toJSON`
    // strips the `att.buffer` field that the adapter pre-populated. We
    // recover by walking `message.raw.item_list` and re-running the same
    // download logic via the package-exported helper.
    const createClient = () =>
      new WechatClientFactory().createClient(
        {
          applicationId: 'wechat-app',
          credentials: { botId: 'bot-id', botToken: 'bot-token' },
          platform: 'wechat',
          settings: {},
        },
        { appUrl: 'https://example.com', redisClient: runtimeRedis as any },
      );

    /** Build a fake Chat SDK Message with a WeChat raw payload. */
    const makeMessage = (raw: Record<string, unknown>, id = 'wechat-msg-1') =>
      ({ id, attachments: [], raw, text: '' }) as any;

    it('returns undefined when raw has no item_list', async () => {
      const client = createClient();
      const result = await client.extractFiles!(makeMessage({}));
      expect(mockDownloadMediaFromRawMessage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('returns undefined when item_list is empty', async () => {
      const client = createClient();
      const result = await client.extractFiles!(makeMessage({ item_list: [] }));
      expect(mockDownloadMediaFromRawMessage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('delegates to downloadMediaFromRawMessage and maps the result to AttachmentSource[]', async () => {
      const buffer = Buffer.from('wechat-image-bytes');
      mockDownloadMediaFromRawMessage.mockResolvedValue([
        {
          buffer,
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          type: 'image',
          url: '',
        },
      ]);

      const client = createClient();
      const raw = {
        item_list: [
          {
            image_item: {
              aeskey: 'hex-key',
              media: { encrypt_query_param: 'enc-1' },
            },
            type: 1, // MessageItemType.IMAGE
          },
        ],
      };
      const result = await client.extractFiles!(makeMessage(raw));

      expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
      // Confirm we pass the api client + raw payload (the helper handles the rest).
      expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(
        expect.anything(), // WechatApiClient instance
        raw,
      );
      expect(result).toEqual([
        { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
      ]);
    });

    it('returns undefined when downloadMediaFromRawMessage resolves to an empty array', async () => {
      mockDownloadMediaFromRawMessage.mockResolvedValue([]);
      const client = createClient();
      const result = await client.extractFiles!(makeMessage({ item_list: [{ type: 99 }] }));
      expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    it('maps file attachments preserving name + size', async () => {
      const buffer = Buffer.from('pdf-bytes');
      mockDownloadMediaFromRawMessage.mockResolvedValue([
        {
          buffer,
          mimeType: 'application/pdf',
          name: 'report.pdf',
          size: 4096,
          type: 'file',
          url: '',
        },
      ]);
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          item_list: [
            {
              file_item: {
                file_name: 'report.pdf',
                len: '4096',
                media: { encrypt_query_param: 'enc-pdf' },
              },
              type: 4, // MessageItemType.FILE
            },
          ],
        }),
      );
      expect(result).toEqual([
        { buffer, mimeType: 'application/pdf', name: 'report.pdf', size: 4096 },
      ]);
    });

    it('maps multiple attachments in a single message', async () => {
      const imageBuf = Buffer.from('img');
      const voiceBuf = Buffer.from('voice');
      mockDownloadMediaFromRawMessage.mockResolvedValue([
        { buffer: imageBuf, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image', url: '' },
        { buffer: voiceBuf, mimeType: 'audio/silk', type: 'audio', url: '' },
      ]);
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          item_list: [
            { image_item: { media: { encrypt_query_param: 'a' } }, type: 1 },
            { type: 2, voice_item: { media: { encrypt_query_param: 'b' } } },
          ],
        }),
      );
      expect(result).toEqual([
        { buffer: imageBuf, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
        { buffer: voiceBuf, mimeType: 'audio/silk', name: undefined, size: undefined },
      ]);
    });

    it('propagates errors from downloadMediaFromRawMessage as undefined gracefully', async () => {
      // The helper itself swallows per-item errors; if it throws as a whole,
      // that's an unexpected programmer error and we let it propagate.
      // This test verifies we DON'T silently swallow whole-helper failures —
      // we want them to surface in logs / be debuggable.
      mockDownloadMediaFromRawMessage.mockRejectedValue(new Error('helper crashed'));
      const client = createClient();
      await expect(
        client.extractFiles!(makeMessage({ item_list: [{ image_item: {}, type: 1 }] })),
      ).rejects.toThrow('helper crashed');
    });
  });
});
