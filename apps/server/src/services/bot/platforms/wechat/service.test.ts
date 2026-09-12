// @vitest-environment node
import { MessageExecutionRuntime } from '@lobechat/builtin-tool-message/executionRuntime';
import type * as WechatAdapterModule from '@lobechat/chat-adapter-wechat';
import type { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AttachmentBudgetModule from '../attachmentBudget';
import type * as PublicUrlFetchModule from '../publicUrlFetch';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('../publicUrlFetch', async () => ({
  // Spread the real module: a full mock silently drops every export it
  // does not name, so adding one to publicUrlFetch breaks suites that
  // never cared about it.
  ...(await vi.importActual<typeof PublicUrlFetchModule>('../publicUrlFetch')),
  fetchPublicUrl: async (url: string, timeoutMs: number) => ({
    dispose: async () => undefined,
    response: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  }),
}));

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
  getWechatTextSendCount: (text: string) => Math.max(1, Math.ceil(text.length / 2000)),
  MessageItemType,
  WechatUploadMediaType,
}));

const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
// Window bookkeeping commands used by contextWindow (legacy-token seeding path).
const mockWindowRedis = vi.hoisted(() => ({
  expire: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn().mockResolvedValue({}),
  hincrby: vi.fn().mockResolvedValue(9),
  hset: vi.fn().mockResolvedValue(1),
  pttl: vi.fn().mockResolvedValue(-1),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ get: mockRedisGet, ...mockWindowRedis }),
}));

const { WechatMessageService } = await import('./service');
const { PLATFORM_ATTACHMENT_BUDGETS } = await import('../attachmentBudget');

vi.mock('../attachmentBudget', async (importOriginal) => {
  const original = await importOriginal<typeof AttachmentBudgetModule>();
  return {
    ...original,
    PLATFORM_ATTACHMENT_BUDGETS: {
      ...original.PLATFORM_ATTACHMENT_BUDGETS,
      wechat: { ...original.PLATFORM_ATTACHMENT_BUDGETS.wechat },
    },
  };
});
const defaultWechatBudget = { ...PLATFORM_ATTACHMENT_BUDGETS.wechat };

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
    Object.assign(PLATFORM_ATTACHMENT_BUDGETS.wechat, defaultWechatBudget);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves text success and reports an attachment upload failure to the runtime', async () => {
    const api = makeApi();
    api.uploadCdnMedia.mockRejectedValueOnce(new Error('synthetic upload failure'));
    const service = new WechatMessageService(api as unknown as WechatApiClient, 'app-1');
    const runtime = new MessageExecutionRuntime({ service });

    const result = await runtime.sendMessage({
      attachments: [
        {
          data: Buffer.from('synthetic-image').toString('base64'),
          name: 'fixture.png',
          type: 'image',
        },
      ],
      channelId: 'user-1@im.wechat',
      content: 'fixture text',
      platform: 'wechat',
    });

    expect(result.success).toBe(false);
    expect(result.state).toMatchObject({
      delivery: {
        attachments: [{ index: 0, reason: 'upload_failed', status: 'failed', type: 'image' }],
        receipt: 'unconfirmed',
        status: 'partial',
        text: { status: 'accepted' },
      },
    });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.uploadCdnMedia).toHaveBeenCalledTimes(1);
    expect(api.sendItem).not.toHaveBeenCalled();
    expect(result.content).not.toContain('messageId: undefined');
    expect(result.content).toContain('Do not resend the entire request');
  });

  it('forwards text via api.sendMessage', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as any, 'app-1');

    const result = await service.sendMessage({
      channelId: 'user-1@im.wechat',
      content: 'hello',
      platform: 'wechat',
    });

    expect(api.sendMessage).toHaveBeenCalledWith('user-1@im.wechat', 'hello', '');
    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendItem).not.toHaveBeenCalled();
    expect(result.delivery).toEqual({
      attachments: [],
      receipt: 'unconfirmed',
      status: 'accepted',
      text: { status: 'accepted' },
    });
  });

  it('consumes one send-window credit per long-text chunk', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as any, 'app-1');
    mockWindowRedis.hgetall.mockResolvedValueOnce({
      refreshedAt: '1',
      remaining: '10',
      token: 'ctx-1',
    });
    mockWindowRedis.hincrby.mockResolvedValueOnce(7);

    await service.sendMessage({
      channelId: 'user-1@im.wechat',
      content: 'a'.repeat(4500),
      platform: 'wechat',
    });

    expect(mockWindowRedis.hincrby).toHaveBeenCalledWith(
      'wechat:ctx-window:app-1:user-1@im.wechat',
      'remaining',
      -3,
    );
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

    const result = await service.sendMessage({
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
    expect(result.delivery).toEqual({
      attachments: [{ index: 0, status: 'accepted', type: 'file' }],
      receipt: 'unconfirmed',
      status: 'accepted',
      text: { status: 'not_requested' },
    });
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

  it('does not consume quota or call the platform for an empty request', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as unknown as WechatApiClient, 'app-1');

    const result = await service.sendMessage({
      channelId: 'fixture',
      content: '',
      platform: 'wechat',
    });

    expect(result.delivery).toEqual({
      attachments: [],
      receipt: 'unconfirmed',
      status: 'failed',
      text: { status: 'not_requested' },
    });
    expect(mockWindowRedis.hincrby).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
  });

  it('reports attachment-only failures without inventing a successful text leg', async () => {
    const api = makeApi();
    const service = new WechatMessageService(api as unknown as WechatApiClient, 'app-1');

    const result = await service.sendMessage({
      attachments: [{ type: 'image' }],
      channelId: 'fixture',
      content: '',
      platform: 'wechat',
    });

    expect(result.delivery).toEqual({
      attachments: [{ index: 0, reason: 'source_unavailable', status: 'failed', type: 'image' }],
      receipt: 'unconfirmed',
      status: 'failed',
      text: { status: 'not_requested' },
    });
    expect(api.sendItem).not.toHaveBeenCalled();
  });

  it('preserves uncertain long-text submission and does not begin attachments', async () => {
    const { WechatApiClient: ActualWechatApiClient } = await vi.importActual<
      typeof WechatAdapterModule
    >('@lobechat/chat-adapter-wechat');
    const api = new ActualWechatApiClient('fixture-token', 'fixture-bot');
    const sendItem = vi.spyOn(api, 'sendItem').mockResolvedValueOnce({ ret: 0 });
    sendItem.mockRejectedValueOnce(new Error('second chunk response lost'));
    const upload = vi.spyOn(api, 'uploadCdnMedia');
    const runtime = new MessageExecutionRuntime({
      service: new WechatMessageService(api, 'app-1'),
    });

    const result = await runtime.sendMessage({
      attachments: [{ data: 'YQ==', type: 'file' }],
      channelId: 'fixture',
      content: 'a'.repeat(6000),
      platform: 'wechat',
    });

    expect(result.success).toBe(false);
    expect(result.state.delivery).toEqual({
      attachments: [
        { index: 0, reason: 'text_not_accepted', status: 'not_attempted', type: 'file' },
      ],
      receipt: 'unconfirmed',
      status: 'unknown',
      text: { reason: 'text_send_unconfirmed', status: 'unknown' },
    });
    expect(sendItem).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves text acceptance when a fallback link rejects: %s',
    async (rejectLink) => {
      const api = makeApi();
      PLATFORM_ATTACHMENT_BUDGETS.wechat.fileMaxBytes = 2;
      if (rejectLink) {
        api.sendMessage.mockResolvedValueOnce({ ret: 0 });
        api.sendMessage.mockRejectedValueOnce(new Error('fallback response lost'));
      }
      const runtime = new MessageExecutionRuntime({
        service: new WechatMessageService(api as unknown as WechatApiClient, 'app-1'),
      });

      const result = await runtime.sendMessage({
        attachments: [{ data: 'Ymln', fetchUrl: 'https://example.com/fixture', type: 'file' }],
        channelId: 'fixture',
        content: 'fixture text',
        platform: 'wechat',
      });

      expect(result.success).toBe(false);
      expect(result.state.delivery).toEqual({
        attachments: [
          {
            index: 0,
            reason: rejectLink ? 'link_send_unconfirmed' : 'over_budget',
            status: rejectLink ? 'unknown' : 'link_fallback',
            type: 'file',
          },
        ],
        receipt: 'unconfirmed',
        status: rejectLink ? 'unknown' : 'degraded',
        text: { status: 'accepted' },
      });
      expect(api.sendMessage).toHaveBeenCalledTimes(2);
    },
  );

  it('publishes only outcome fields when a media submission error includes request details', async () => {
    const api = makeApi();
    const markers = [
      'https://example.com/private-source',
      'fixture-private-token',
      'fixture-base64',
    ];
    api.sendItem.mockRejectedValueOnce(new Error(markers.join(' ')));
    const runtime = new MessageExecutionRuntime({
      service: new WechatMessageService(api as unknown as WechatApiClient, 'app-1'),
    });

    const result = await runtime.sendMessage({
      attachments: [{ data: 'YQ==', fetchUrl: markers[0], type: 'image' }],
      channelId: 'fixture',
      content: 'fixture text',
      platform: 'wechat',
    });

    expect(result.success).toBe(false);
    expect(result.state.delivery).toMatchObject({
      attachments: [{ index: 0, reason: 'send_unconfirmed', status: 'unknown', type: 'image' }],
      status: 'unknown',
      text: { status: 'accepted' },
    });
    for (const marker of markers) expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
