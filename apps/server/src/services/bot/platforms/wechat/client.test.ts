import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWechatAdapter = vi.hoisted(() => vi.fn());
const mockGetUpdates = vi.hoisted(() => vi.fn());
const mockStartTyping = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn().mockResolvedValue({ ret: 0 }));
const mockSendItem = vi.hoisted(() => vi.fn().mockResolvedValue({ ret: 0 }));
const mockUploadCdnMedia = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    aesKey: 'aes-key',
    cipherSize: 128,
    encryptQueryParam: 'enc-param',
  }),
);
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const MessageState = vi.hoisted(() => ({ FINISH: 2 }));
const MessageType = vi.hoisted(() => ({ BOT: 2, USER: 1 }));
const MessageItemType = vi.hoisted(() => ({
  FILE: 4,
  IMAGE: 1,
  TEXT: 0,
  VIDEO: 3,
  VOICE: 2,
}));
const WechatUploadMediaType = vi.hoisted(() => ({
  FILE: 4,
  IMAGE: 1,
  VIDEO: 3,
  VOICE: 2,
}));

vi.mock('@lobechat/chat-adapter-wechat', () => ({
  createWechatAdapter: mockCreateWechatAdapter,
  downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
  getWechatTextSendCount: (text: string) => Math.max(1, Math.ceil(text.length / 2000)),
  MessageItemType,
  MessageState,
  MessageType,
  WechatApiClient: vi.fn().mockImplementation(() => ({
    getUpdates: mockGetUpdates,
    sendItem: mockSendItem,
    sendMessage: mockSendMessage,
    startTyping: mockStartTyping,
    uploadCdnMedia: mockUploadCdnMedia,
  })),
  WechatUploadMediaType,
}));

const { WechatClientFactory } = await import('./client');

describe('WechatGatewayClient', () => {
  const runtimeRedis = {
    del: vi.fn(),
    expire: vi.fn(),
    get: vi.fn(),
    hgetall: vi.fn(),
    hincrby: vi.fn(),
    hset: vi.fn(),
    pttl: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    runtimeRedis.get.mockResolvedValue(null);
    runtimeRedis.set.mockResolvedValue('OK');
    runtimeRedis.del.mockResolvedValue(1);
    runtimeRedis.expire.mockResolvedValue(1);
    runtimeRedis.hgetall.mockResolvedValue({});
    runtimeRedis.hincrby.mockResolvedValue(9);
    runtimeRedis.hset.mockResolvedValue(1);
    runtimeRedis.pttl.mockResolvedValue(-1);
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
        credentials: {
          botId: 'bot-id',
          botToken: 'bot-token',
          webhookToken: 'gateway-service-token',
        },
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
        headers: {
          'Authorization': 'Bearer gateway-service-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
    expect(runtimeRedis.hset.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
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

  it('tracks messages sent directly by the Chat SDK adapter', async () => {
    const client = new WechatClientFactory().createClient(
      {
        applicationId: 'wechat-app',
        credentials: { botId: 'bot-id', botToken: 'bot-token' },
        platform: 'wechat',
        settings: {},
      },
      { appUrl: 'https://example.com', redisClient: runtimeRedis as any },
    );

    client.createAdapter();
    const adapterConfig = mockCreateWechatAdapter.mock.calls[0][0];
    runtimeRedis.hgetall.mockResolvedValueOnce({
      refreshedAt: '1',
      remaining: '10',
      token: 'ctx-1',
    });
    await adapterConfig.onBeforeSendMessage({ count: 1, toUserId: 'user-1@im.wechat' });

    expect(runtimeRedis.hincrby).toHaveBeenCalledWith(
      'wechat:ctx-window:wechat-app:user-1@im.wechat',
      'remaining',
      -1,
    );
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
      expect(result).toEqual({
        files: [{ buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined }],
        warnings: undefined,
      });
    });

    it('returns undefined when downloadMediaFromRawMessage resolves to an empty array', async () => {
      mockDownloadMediaFromRawMessage.mockResolvedValue([]);
      const client = createClient();
      const result = await client.extractFiles!(makeMessage({ item_list: [{ type: 99 }] }));
      expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    it('warns when a FILE item has no downloadable media (e.g. oversized) and was dropped', async () => {
      // WeChat relays oversized files as metadata only — no CDN media handle —
      // so downloadMediaFromRawMessage returns nothing for them. We must surface
      // a warning instead of silently passing only the `[file: name]` text.
      mockDownloadMediaFromRawMessage.mockResolvedValue([]);
      const client = createClient();
      const result = (await client.extractFiles!(
        makeMessage({
          item_list: [
            {
              file_item: {
                file_name: 'October 11, 2023 Alta Town Council Meeting Audio.mp3',
                len: '132800970',
              },
              type: 4, // MessageItemType.FILE
            },
          ],
        }),
      )) as { files?: unknown[]; warnings?: string[] } | undefined;
      expect(result?.files).toBeUndefined();
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings?.[0]).toContain(
        'October 11, 2023 Alta Town Council Meeting Audio.mp3',
      );
      expect(result?.warnings?.[0]).toContain('126.6 MB');
      expect(result?.warnings?.[0]).toContain('could not be retrieved');
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
      expect(result).toEqual({
        files: [{ buffer, mimeType: 'application/pdf', name: 'report.pdf', size: 4096 }],
        warnings: undefined,
      });
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
      expect(result).toEqual({
        files: [
          { buffer: imageBuf, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
          { buffer: voiceBuf, mimeType: 'audio/silk', name: undefined, size: undefined },
        ],
        warnings: undefined,
      });
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

  describe('messenger.createMessage with attachments', () => {
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

    it('forwards inline base64 image attachments to uploadCdnMedia + sendItem', async () => {
      const client = createClient();
      const messenger = client.getMessenger('wechat:p2p:user-1@im.wechat');

      // Pre-seed an in-memory context token; the adapter caches per-user.
      runtimeRedis.get.mockResolvedValueOnce('ctx-from-redis');

      await messenger.createMessage({
        attachments: [
          {
            data: Buffer.from('image-bytes').toString('base64'),
            mimeType: 'image/png',
            name: 'foo.png',
            type: 'image',
          },
        ],
        content: 'Here you go',
      });

      // Text leg goes through the standard sendMessage call.
      expect(mockSendMessage).toHaveBeenCalledWith(
        'user-1@im.wechat',
        'Here you go',
        'ctx-from-redis',
      );
      // Attachment leg: upload bytes, then send a media item.
      expect(mockUploadCdnMedia).toHaveBeenCalledWith(
        'user-1@im.wechat',
        WechatUploadMediaType.IMAGE,
        expect.any(Buffer),
      );
      expect(mockSendItem).toHaveBeenCalledWith(
        'user-1@im.wechat',
        expect.objectContaining({
          image_item: expect.objectContaining({
            media: expect.objectContaining({
              aes_key: 'aes-key',
              encrypt_query_param: 'enc-param',
            }),
          }),
          type: MessageItemType.IMAGE,
        }),
        'ctx-from-redis',
      );
    });

    it('fetches and uploads attachments delivered as fetchUrl', async () => {
      const client = createClient();
      const messenger = client.getMessenger('wechat:p2p:user-2@im.wechat');

      runtimeRedis.get.mockResolvedValueOnce('ctx-2');
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'Content-Type': 'image/png' },
          status: 200,
        }) as any,
      );

      await messenger.createMessage({
        attachments: [
          {
            fetchUrl: 'https://cdn.example.com/pic.png',
            name: 'pic.png',
            type: 'image',
          },
        ],
        content: 'pic',
      });

      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/pic.png', expect.any(Object));
      expect(mockUploadCdnMedia).toHaveBeenCalledTimes(1);
      expect(mockSendItem).toHaveBeenCalledTimes(1);
    });

    it('continues sending remaining attachments when one fails', async () => {
      const client = createClient();
      const messenger = client.getMessenger('wechat:p2p:user-3@im.wechat');

      runtimeRedis.get.mockResolvedValueOnce('ctx-3');
      mockUploadCdnMedia.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValueOnce({
        aesKey: 'aes-2',
        cipherSize: 64,
        encryptQueryParam: 'enc-2',
      });

      await messenger.createMessage({
        attachments: [
          { data: Buffer.from('a').toString('base64'), type: 'image' },
          { data: Buffer.from('b').toString('base64'), type: 'image' },
        ],
        content: '',
      });

      // Two upload attempts, one sendItem success after the first failure.
      expect(mockUploadCdnMedia).toHaveBeenCalledTimes(2);
      expect(mockSendItem).toHaveBeenCalledTimes(1);
    });

    it('accepts plain string content (legacy form) and skips attachment path', async () => {
      const client = createClient();
      const messenger = client.getMessenger('wechat:p2p:user-4@im.wechat');

      runtimeRedis.get.mockResolvedValueOnce('ctx-4');
      await messenger.createMessage('text only');

      expect(mockSendMessage).toHaveBeenCalledWith('user-4@im.wechat', 'text only', 'ctx-4');
      expect(mockUploadCdnMedia).not.toHaveBeenCalled();
      expect(mockSendItem).not.toHaveBeenCalled();
    });

    it('tracks every long-text chunk against the send-window quota', async () => {
      const client = createClient();
      const messenger = client.getMessenger('wechat:p2p:user-5@im.wechat');

      runtimeRedis.get.mockResolvedValueOnce('ctx-5');
      runtimeRedis.hgetall.mockResolvedValueOnce({
        refreshedAt: '1',
        remaining: '10',
        token: 'ctx-5',
      });
      runtimeRedis.hincrby.mockResolvedValueOnce(7);

      await messenger.createMessage('a'.repeat(4500));

      await vi.waitFor(() => {
        expect(runtimeRedis.hincrby).toHaveBeenCalledWith(
          'wechat:ctx-window:wechat-app:user-5@im.wechat',
          'remaining',
          -3,
        );
      });
      expect(runtimeRedis.hincrby.mock.invocationCallOrder[0]).toBeLessThan(
        mockSendMessage.mock.invocationCallOrder[0],
      );
    });
  });
});
