// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  MessageItemType,
  WechatUploadMediaType,
}));

const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ get: mockRedisGet }),
}));

const { WechatMessageService } = await import('./service');

const makeApi = () => ({
  sendItem: vi.fn().mockResolvedValue({ ret: 0 }),
  sendMessage: vi.fn().mockResolvedValue({ ret: 0 }),
  uploadCdnMedia: vi.fn().mockResolvedValue({
    aesKey: 'aes-key',
    cipherSize: 64,
    encryptQueryParam: 'enc-param',
  }),
});

describe('WechatMessageService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mockRedisGet.mockResolvedValue(null);
  });

  it('forwards text via api.sendMessage', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as any, 'app-1');

    await service.sendMessage({
      channelId: 'user-1@im.wechat',
      content: 'hello',
      platform: 'wechat',
    });

    expect(api.sendMessage).toHaveBeenCalledWith('user-1@im.wechat', 'hello', '');
    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendItem).not.toHaveBeenCalled();
  });

  it('uploads + sends attachments as separate iLink items (text + image)', async () => {
    const api = makeApi();
    mockRedisGet.mockResolvedValueOnce('ctx-1');
    const service = new WechatMessageService(api as any, 'app-1');

    await service.sendMessage({
      attachments: [
        {
          data: Buffer.from('image-bytes').toString('base64'),
          mimeType: 'image/png',
          name: 'foo.png',
          type: 'image',
        },
      ],
      channelId: 'user-1@im.wechat',
      content: 'here you go',
      platform: 'wechat',
    });

    expect(api.sendMessage).toHaveBeenCalledWith('user-1@im.wechat', 'here you go', 'ctx-1');
    expect(api.uploadCdnMedia).toHaveBeenCalledWith(
      'user-1@im.wechat',
      WechatUploadMediaType.IMAGE,
      expect.any(Buffer),
    );
    expect(api.sendItem).toHaveBeenCalledWith(
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
      'ctx-1',
    );
  });

  it('skips the text leg when content is empty but still sends attachments', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as any, 'app-1');

    await service.sendMessage({
      attachments: [
        { data: Buffer.from('pdf-bytes').toString('base64'), name: 'a.pdf', type: 'file' },
      ],
      channelId: 'user-2@im.wechat',
      content: '',
      platform: 'wechat',
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.uploadCdnMedia).toHaveBeenCalledTimes(1);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
  });

  it('fetches attachments delivered as fetchUrl', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as any, 'app-1');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([9, 9, 9, 9]), {
        headers: { 'Content-Type': 'image/png' },
        status: 200,
      }) as any,
    );

    await service.sendMessage({
      attachments: [{ fetchUrl: 'https://cdn.example.com/pic.png', type: 'image' }],
      channelId: 'user-3@im.wechat',
      content: '',
      platform: 'wechat',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/pic.png', expect.any(Object));
    expect(api.uploadCdnMedia).toHaveBeenCalledTimes(1);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
  });
});
