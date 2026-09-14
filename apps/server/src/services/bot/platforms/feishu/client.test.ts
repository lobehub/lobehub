import type * as FeishuAdapterModule from '@lobechat/chat-adapter-feishu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateLarkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetTenantAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
const mockAddReaction = vi.hoisted(() => vi.fn());
const mockRemoveReaction = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/chat-adapter-feishu', async (importOriginal) => ({
  // Keep the real `decodeLarkThreadId` — the messenger decodes the threadId
  // before it ever touches the API, so stubbing it would test nothing.
  ...(await importOriginal<typeof FeishuAdapterModule>()),
  createLarkAdapter: mockCreateLarkAdapter,
  downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
  LarkApiClient: vi.fn().mockImplementation(function () {
    return {
      addReaction: mockAddReaction,
      getTenantAccessToken: mockGetTenantAccessToken,
      removeReaction: mockRemoveReaction,
    };
  }),
}));

// Keep `./reactionTracker` real — the key layout and the read-before-write
// ordering are exactly what the stacking fix depends on.
const reactionStore = vi.hoisted(() => new Map<string, string>());
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({
    del: async (key: string) => reactionStore.delete(key),
    get: async (key: string) => reactionStore.get(key) ?? null,
    set: async (key: string, value: string) => reactionStore.set(key, value),
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
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./gateway', () => ({
  FeishuWSConnection: vi.fn().mockImplementation(function () {
    return {
      close: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };
  }),
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
    mockDownloadMediaFromRawMessage.mockReset();
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
      expect.objectContaining({ warn: expect.any(Function) }),
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

  it('keeps post images across webhook parse + queue serialization + extractFiles', async () => {
    const actualAdapter = await vi.importActual<typeof FeishuAdapterModule>(
      '@lobechat/chat-adapter-feishu',
    );
    const { Message } = await import('chat');
    const processMessage = vi.fn();
    const adapter = new actualAdapter.LarkAdapter({
      appId: 'cli_test_app',
      appSecret: 'sec',
      platform: 'feishu',
    });
    (adapter as any).chat = { processMessage };
    (adapter as any).logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    vi.spyOn(adapter as any, 'resolveSenderName').mockResolvedValue('User');

    const raw = {
      chat_id: 'oc_test',
      chat_type: 'group',
      content: JSON.stringify({
        content_v2: [
          [
            { tag: 'text', text: '请分析' },
            { tag: 'img', image_key: 'img_first' },
          ],
          [{ tag: 'md', text: '补充图：![second](img_second)' }],
        ],
      }),
      create_time: '1700000000000',
      message_id: 'om_post',
      message_type: 'post',
    };
    const request = new Request('http://localhost/webhook', {
      body: JSON.stringify({
        event: {
          message: raw,
          sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
        },
        header: { event_type: 'im.message.receive_v1' },
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await adapter.handleWebhook(request);
    const messageFactory = processMessage.mock.calls[0][2];
    const parsedMessage = await messageFactory();
    const queuedMessage = Message.fromJSON(parsedMessage.toJSON());

    const downloadResource = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from('first'))
      .mockResolvedValueOnce(Buffer.from('second'));
    mockDownloadMediaFromRawMessage.mockImplementation(actualAdapter.downloadMediaFromRawMessage);
    const client = createClient();
    (client as any)._api = { downloadResource };

    const result = await client.extractFiles!(queuedMessage);

    expect(queuedMessage.text).toBe('请分析[image]\n补充图：[image]');
    expect(queuedMessage.attachments).toHaveLength(2);
    expect(downloadResource.mock.calls).toEqual([
      ['om_post', 'img_first', 'image'],
      ['om_post', 'img_second', 'image'],
    ]);
    expect(result).toEqual([
      {
        buffer: Buffer.from('first'),
        mimeType: 'image/jpeg',
        name: 'image-1.jpg',
        size: undefined,
      },
      {
        buffer: Buffer.from('second'),
        mimeType: 'image/jpeg',
        name: 'image-2.jpg',
        size: undefined,
      },
    ]);
  });
});

describe('Feishu messenger reactions', () => {
  const messenger = (platform: 'feishu' | 'lark' = 'lark') =>
    new FeishuClientFactory()
      .createClient(
        {
          applicationId: 'cli_test_app',
          credentials: { appSecret: 'sec', encryptKey: 'enc' },
          platform,
          settings: {},
        },
        {},
      )
      .getMessenger(`${platform}:group:oc_chat_1`);

  beforeEach(async () => {
    reactionStore.clear();
    mockAddReaction.mockReset().mockResolvedValue({ reactionId: 'rct_1' });
    mockRemoveReaction.mockReset().mockResolvedValue(undefined);
    // The suite above ends on `vi.restoreAllMocks()`, which strips the module
    // factory's constructor implementation — re-establish it here rather than
    // depending on describe ordering.
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    vi.mocked(LarkApiClient).mockImplementation(function () {
      return {
        addReaction: mockAddReaction,
        getTenantAccessToken: mockGetTenantAccessToken,
        removeReaction: mockRemoveReaction,
      } as any;
    });
  });

  it('sends the named emoji_type Feishu accepts, not the bridge unicode', async () => {
    // '\u{1F440}' straight through is what returns `231001 reaction type is invalid`.
    await messenger().replaceReaction!('om_1', null, '\u{1F440}');

    expect(mockAddReaction).toHaveBeenCalledWith('om_1', 'OK');
  });

  it('removes the previous reaction on a step swap instead of stacking a second one', async () => {
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_received' });
    await m.replaceReaction!('om_1', null, '\u{1F440}');

    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_thinking' });
    await m.replaceReaction!('om_1', '\u{1F440}', '\u{1F914}');

    // Add first, then drop the old one — the user always sees one reaction.
    expect(mockAddReaction).toHaveBeenLastCalledWith('om_1', 'THINKING');
    expect(mockRemoveReaction).toHaveBeenCalledWith('om_1', 'rct_received');
  });

  it('clears the last reaction when the run finishes', async () => {
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_working' });
    await m.replaceReaction!('om_1', null, '\u{26A1}');

    await m.replaceReaction!('om_1', '\u{26A1}', null);

    expect(mockRemoveReaction).toHaveBeenCalledWith('om_1', 'rct_working');
    // …and the pointer is gone, so a later clear can't double-delete.
    expect([...reactionStore.keys()]).toHaveLength(0);
  });

  it('skips the swap when both emoji map to the same emoji_type', async () => {
    // '\u{1F44C}' and '\u{1F440}' both resolve to OK — re-placing it would swap a
    // live reaction for an identical one.
    await messenger().replaceReaction!('om_1', '\u{1F44C}', '\u{1F440}');

    expect(mockAddReaction).not.toHaveBeenCalled();
    expect(mockRemoveReaction).not.toHaveBeenCalled();
  });

  it('retries a transient failure of the final clear in place', async () => {
    // Nothing upstream retries the clear (the bridge and the queue callback
    // both drop their reaction state afterwards), so the messenger must.
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_working' });
    await m.replaceReaction!('om_1', null, '\u{26A1}');

    mockRemoveReaction.mockRejectedValueOnce(new Error('network'));
    await m.replaceReaction!('om_1', '\u{26A1}', null);

    expect(mockRemoveReaction).toHaveBeenCalledTimes(2);
    expect([...reactionStore.keys()]).toHaveLength(0);
  });

  it('keeps the id when the final clear keeps failing, so a later cleanup can still use it', async () => {
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_working' });
    await m.replaceReaction!('om_1', null, '\u{26A1}');

    // Forgetting the id BEFORE the delete succeeds would leave the reaction
    // visible with nothing left to delete it by.
    mockRemoveReaction
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));
    await expect(m.replaceReaction!('om_1', '\u{26A1}', null)).rejects.toThrow('could not remove');
    expect([...reactionStore.values()]).toEqual([JSON.stringify(['rct_working'])]);

    await m.removeReaction!('om_1', '\u{26A1}');
    expect(mockRemoveReaction).toHaveBeenLastCalledWith('om_1', 'rct_working');
    expect([...reactionStore.keys()]).toHaveLength(0);
  });

  it('keeps the previous id when a swap adds fine but cannot remove it, and clears both later', async () => {
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_received' });
    await m.replaceReaction!('om_1', null, '\u{1F440}');

    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_thinking' });
    mockRemoveReaction
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));
    await expect(m.replaceReaction!('om_1', '\u{1F440}', '\u{1F914}')).rejects.toThrow(
      'could not remove',
    );
    // Both ids survive: the one that could not be removed and the one just placed.
    expect([...reactionStore.values()]).toEqual([JSON.stringify(['rct_received', 'rct_thinking'])]);

    mockRemoveReaction.mockClear();
    await m.replaceReaction!('om_1', '\u{1F914}', null);
    expect(mockRemoveReaction.mock.calls.map(([, id]) => id)).toEqual([
      'rct_received',
      'rct_thinking',
    ]);
    expect([...reactionStore.keys()]).toHaveLength(0);
  });

  it('keeps the stale pointer when the add fails, so the next swap retries cleanup', async () => {
    const m = messenger();
    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_received' });
    await m.replaceReaction!('om_1', null, '\u{1F440}');

    mockAddReaction.mockRejectedValueOnce(new Error('network'));
    await expect(m.replaceReaction!('om_1', '\u{1F440}', '\u{1F914}')).rejects.toThrow('network');

    mockAddReaction.mockResolvedValueOnce({ reactionId: 'rct_thinking' });
    await m.replaceReaction!('om_1', '\u{1F440}', '\u{1F914}');
    expect(mockRemoveReaction).toHaveBeenCalledWith('om_1', 'rct_received');
  });
});
