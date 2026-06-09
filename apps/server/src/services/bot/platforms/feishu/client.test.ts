import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateLarkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetTenantAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));

vi.mock('@lobechat/chat-adapter-feishu', () => ({
  createLarkAdapter: mockCreateLarkAdapter,
  downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
  LarkApiClient: vi.fn().mockImplementation(() => ({
    getTenantAccessToken: mockGetTenantAccessToken,
  })),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./gateway', () => ({
  FeishuWSConnection: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  })),
}));

const { FeishuClientFactory } = await import('./client');

describe('FeishuWebhookClient.extractFiles', () => {
  // Verifies the post-Redis re-download path: when Feishu messages
  // round-trip through the chat-sdk debounce/queue, `Message.toJSON`
  // strips both `att.buffer` and `att.fetchData`. We recover by walking
  // `message.raw.content` (JSON) and re-running the same download logic
  // via the package-exported helper.

  const createClient = (platform: 'feishu' | 'lark' = 'feishu') =>
    new FeishuClientFactory().createClient(
      {
        applicationId: 'cli_test_app',
        credentials: { appSecret: 'sec', encryptKey: 'enc' },
        platform,
        // No connectionMode → defaults to webhook
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );

  /** Build a fake Chat SDK Message with a Lark raw payload. */
  const makeMessage = (raw: Record<string, unknown>, id = 'om_test_msg_001') =>
    ({ id, attachments: [], raw, text: '' }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when message has no raw payload', async () => {
    const client = createClient();
    const message = { id: 'm', attachments: [], text: '' } as any;
    const result = await client.extractFiles!(message);
    expect(mockDownloadMediaFromRawMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('delegates to downloadMediaFromRawMessage and maps the result', async () => {
    const buffer = Buffer.from('lark-image-bytes');
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      {
        buffer,
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        type: 'image',
      },
    ]);

    const client = createClient();
    const raw = {
      chat_id: 'oc_test',
      content: JSON.stringify({ image_key: 'img_1' }),
      create_time: '1700000000000',
      message_id: 'om_test_msg_001',
      message_type: 'image',
    };
    const result = await client.extractFiles!(makeMessage(raw));

    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(
      expect.anything(), // LarkApiClient instance
      raw,
    );
    expect(result).toEqual([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
    ]);
  });

  it('returns undefined when downloadMediaFromRawMessage resolves to empty array', async () => {
    mockDownloadMediaFromRawMessage.mockResolvedValue([]);
    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        message_id: 'm',
        message_type: 'text',
        content: JSON.stringify({ text: 'hi' }),
      }),
    );
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
      },
    ]);
    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        message_id: 'm',
        message_type: 'file',
        content: JSON.stringify({ file_key: 'f', file_name: 'report.pdf' }),
      }),
    );
    expect(result).toEqual([
      { buffer, mimeType: 'application/pdf', name: 'report.pdf', size: 4096 },
    ]);
  });

  it('caches LarkApiClient across multiple extractFiles calls (token cache hot)', async () => {
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    const ctorSpy = vi.mocked(LarkApiClient);
    const ctorCallCountBefore = ctorSpy.mock.calls.length;

    const client = createClient();
    mockDownloadMediaFromRawMessage.mockResolvedValue([]);

    await client.extractFiles!(
      makeMessage({ message_id: 'm1', message_type: 'text', content: '{}' }),
    );
    await client.extractFiles!(
      makeMessage({ message_id: 'm2', message_type: 'text', content: '{}' }),
    );

    // The lazy `_api` getter should construct LarkApiClient at most ONCE per
    // FeishuWebhookClient instance, so the second extractFiles call reuses
    // the same instance (and its tenant token cache).
    expect(ctorSpy.mock.calls.length - ctorCallCountBefore).toBeLessThanOrEqual(1);
  });

  it('propagates errors from downloadMediaFromRawMessage as-is', async () => {
    mockDownloadMediaFromRawMessage.mockRejectedValue(new Error('helper crashed'));
    const client = createClient();
    await expect(
      client.extractFiles!(
        makeMessage({
          message_id: 'm',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'k' }),
        }),
      ),
    ).rejects.toThrow('helper crashed');
  });

  it('works the same for lark platform variant', async () => {
    const buffer = Buffer.from('lark');
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' },
    ]);

    const client = createClient('lark');
    const raw = {
      chat_id: 'oc_test',
      content: JSON.stringify({ image_key: 'img_1' }),
      create_time: '1700000000000',
      message_id: 'om_test_msg_001',
      message_type: 'image',
    };
    const result = await client.extractFiles!(makeMessage(raw));

    expect(result).toEqual([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
    ]);
  });
});
