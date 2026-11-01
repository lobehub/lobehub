import type * as FeishuAdapterModule from '@lobechat/chat-adapter-feishu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateLarkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetTenantAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
const mockAddReaction = vi.hoisted(() => vi.fn());
const mockRemoveReaction = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockGetUserInfo = vi.hoisted(() => vi.fn());

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

const { FeishuClientFactory, classifyLarkAuthError } = await import('./client');

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

describe('FeishuWebhookClient.extractFiles — quoted (parent) message', () => {
  // A Feishu reply only carries `parent_id`; the quoted message's text and
  // attachments must be fetched with `GET /im/v1/messages/:id` and merged in,
  // otherwise "@bot, put this customer into the pipeline sheet" while quoting
  // a PDF gives the model nothing but the sentence.

  const createClient = () => {
    const client = new FeishuClientFactory().createClient(
      {
        applicationId: 'cli_test_app',
        credentials: { appSecret: 'sec', encryptKey: 'enc' },
        platform: 'feishu',
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );
    // Inject the API surface directly — the module-level `LarkApiClient`
    // constructor mock is reset by `vi.restoreAllMocks()` in earlier suites.
    (client as any)._api = { getMessage: mockGetMessage, getUserInfo: mockGetUserInfo };
    return client;
  };

  const makeMessage = (raw: Record<string, unknown>, id = 'om_reply') =>
    ({ id, attachments: [], raw, text: '' }) as any;

  const replyRaw = () => ({
    chat_id: 'oc_test',
    content: JSON.stringify({ text: '@_user_1 能把这个客户落到我们的商机表里面吗？' }),
    create_time: '1700000000000',
    message_id: 'om_reply',
    message_type: 'text',
    parent_id: 'om_parent',
    root_id: 'om_parent',
  });

  const parentFileItem = () => ({
    body: { content: JSON.stringify({ file_key: 'file_v1', file_name: '深度调研.pdf' }) },
    chat_id: 'oc_test',
    create_time: '1699999990000',
    message_id: 'om_parent',
    msg_type: 'file',
    sender: { id: 'ou_luken', id_type: 'open_id', sender_type: 'user' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadMediaFromRawMessage.mockReset();
    mockGetMessage.mockReset();
    mockGetUserInfo.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch anything extra when the message is not a reply', async () => {
    mockDownloadMediaFromRawMessage.mockResolvedValue([]);
    const client = createClient();
    const raw = { ...replyRaw(), parent_id: undefined, root_id: undefined };

    const result = await client.extractFiles!(makeMessage(raw));

    expect(mockGetMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect((raw as any).referenced_message).toBeUndefined();
  });

  it('downloads the quoted file with the parent message id and surfaces its text', async () => {
    const buffer = Buffer.from('pdf-bytes');
    mockGetMessage.mockResolvedValue({ items: [parentFileItem()] });
    mockGetUserInfo.mockResolvedValue({ name: '陆肯' });
    mockDownloadMediaFromRawMessage.mockImplementation(async (_api: any, raw: any) =>
      raw.message_type === 'file'
        ? [
            {
              buffer,
              mimeType: 'application/octet-stream',
              name: '深度调研.pdf',
              type: 'file',
            },
          ]
        : [],
    );

    const client = createClient();
    const raw = replyRaw();
    const result = await client.extractFiles!(makeMessage(raw));

    expect(mockGetMessage).toHaveBeenCalledWith('om_parent');
    // Second download call is for the normalized parent message: the
    // resource API is keyed by the message that owns the file.
    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(2);
    expect(mockDownloadMediaFromRawMessage.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        content: parentFileItem().body.content,
        message_id: 'om_parent',
        message_type: 'file',
      }),
    );
    expect(result).toEqual([
      { buffer, mimeType: 'application/octet-stream', name: '深度调研.pdf', size: undefined },
    ]);
    // The quoted text is handed to `formatPrompt` through the same
    // `referenced_message` shape Discord uses.
    expect((raw as any).referenced_message).toEqual({
      author: { username: '陆肯' },
      content: '[file] 深度调研.pdf',
    });
  });

  it('merges quoted attachments after the direct ones', async () => {
    const direct = Buffer.from('direct-image');
    const quoted = Buffer.from('quoted-file');
    mockGetMessage.mockResolvedValue({ items: [parentFileItem()] });
    mockGetUserInfo.mockResolvedValue({ name: '陆肯' });
    mockDownloadMediaFromRawMessage.mockImplementation(async (_api: any, raw: any) =>
      raw.message_id === 'om_parent'
        ? [{ buffer: quoted, mimeType: 'application/octet-stream', name: 'q.pdf', type: 'file' }]
        : [{ buffer: direct, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' }],
    );

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        ...replyRaw(),
        content: JSON.stringify({ image_key: 'img_1' }),
        message_type: 'image',
      }),
    );

    expect(result).toEqual([
      expect.objectContaining({ name: 'image.jpg' }),
      expect.objectContaining({ name: 'q.pdf' }),
    ]);
  });

  it('falls back to the sender open_id when the contact API is unavailable', async () => {
    mockGetMessage.mockResolvedValue({
      items: [
        {
          ...parentFileItem(),
          body: { content: JSON.stringify({ text: '客户：康诺亚，对接人：张三' }) },
          msg_type: 'text',
        },
      ],
    });
    mockGetUserInfo.mockRejectedValue(new Error('99991672 Access denied'));
    mockDownloadMediaFromRawMessage.mockResolvedValue([]);

    const client = createClient();
    const raw = replyRaw();
    const result = await client.extractFiles!(makeMessage(raw));

    expect(result).toBeUndefined();
    expect((raw as any).referenced_message).toEqual({
      author: { username: 'ou_luken' },
      content: '客户：康诺亚，对接人：张三',
    });
  });

  it('keeps the direct attachments when the parent message cannot be fetched', async () => {
    const direct = Buffer.from('direct-image');
    mockGetMessage.mockRejectedValue(new Error('230011 no permission'));
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      { buffer: direct, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' },
    ]);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = createClient();
    const raw = {
      ...replyRaw(),
      content: JSON.stringify({ image_key: 'k' }),
      message_type: 'image',
    };
    const result = await client.extractFiles!(makeMessage(raw));

    expect(result).toEqual([
      { buffer: direct, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
    ]);
    expect((raw as any).referenced_message).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('ignores a recalled parent message', async () => {
    mockGetMessage.mockResolvedValue({ items: [{ ...parentFileItem(), deleted: true }] });
    mockDownloadMediaFromRawMessage.mockResolvedValue([]);

    const client = createClient();
    const raw = replyRaw();
    const result = await client.extractFiles!(makeMessage(raw));

    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
    expect((raw as any).referenced_message).toBeUndefined();
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

describe('FeishuClientFactory.validateCredentials', () => {
  beforeEach(() => {
    mockGetTenantAccessToken.mockReset();
  });

  it('passes when a tenant access token can be issued', async () => {
    mockGetTenantAccessToken.mockResolvedValueOnce('tok');

    await expect(
      new FeishuClientFactory().validateCredentials({ appSecret: 's' }, {}, 'cli_x', 'feishu'),
    ).resolves.toEqual({ valid: true });
  });

  it('surfaces the platform error instead of a bare authentication failure', async () => {
    mockGetTenantAccessToken.mockRejectedValueOnce(
      new Error('Lark auth error: 10003 invalid app_secret'),
    );

    const result = await new FeishuClientFactory().validateCredentials(
      { appSecret: 'wrong' },
      {},
      'cli_x',
      'feishu',
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        code: 'invalid_credentials',
        field: 'credentials',
        message:
          'Failed to authenticate with Feishu API: Lark auth error: 10003 invalid app_secret',
      },
    ]);
  });

  it('leaves the code out when the platform error is not recognized', async () => {
    mockGetTenantAccessToken.mockRejectedValueOnce(new Error('Lark auth error: 424242 weird'));

    const result = await new FeishuClientFactory().validateCredentials(
      { appSecret: 's' },
      {},
      'cli_x',
      'feishu',
    );

    expect(result.errors?.[0]).toEqual({
      code: undefined,
      field: 'credentials',
      message: 'Failed to authenticate with Feishu API: Lark auth error: 424242 weird',
    });
  });

  it('reports missing fields before calling the API', async () => {
    const result = await new FeishuClientFactory().validateCredentials({}, {}, undefined, 'feishu');

    expect(result.valid).toBe(false);
    expect(result.errors?.map((e) => e.field)).toEqual(['applicationId', 'appSecret']);
    expect(result.errors?.every((e) => e.code === 'missing_credentials')).toBe(true);
    expect(mockGetTenantAccessToken).not.toHaveBeenCalled();
  });
});

describe('classifyLarkAuthError', () => {
  it.each([
    ['Lark auth error: 10003 invalid param', 'invalid_credentials'],
    ['Lark auth error: 10015 wrong app secret', 'invalid_credentials'],
    ['Lark auth error: 20002 app_id and app_secret did not match', 'invalid_credentials'],
    ['Lark auth error: 10014 app unauthorized', 'permission_denied'],
    ['Lark auth error: 99991401 ip 1.2.3.4 is denied by app setting', 'permission_denied'],
    ['Lark auth error: 11209 app not exist', 'application_not_found'],
    ['Lark auth error: 99991400 request trigger frequency limit', 'rate_limited'],
    ['Lark auth failed: 429 slow down', 'rate_limited'],
    ['Lark auth failed: 503 <html>', 'upstream_unavailable'],
    ['fetch failed', 'upstream_unavailable'],
    ['Lark auth error: 424242 weird', undefined],
    ['Lark auth failed: 400 bad', undefined],
    [undefined, undefined],
  ])('%s -> %s', (detail, code) => {
    expect(classifyLarkAuthError(detail)).toBe(code);
  });
});
