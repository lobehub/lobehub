import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateLarkAdapter = vi.hoisted(() => vi.fn());
const mockDownloadMediaFromRawMessage = vi.hoisted(() => vi.fn());
const mockGetTenantAccessToken = vi.hoisted(() => vi.fn().mockResolvedValue('tok'));
const mockListMessages = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockGetUserInfo = vi.hoisted(() => vi.fn());
const mockReplyMessage = vi.hoisted(() => vi.fn());
const mockReplyCard = vi.hoisted(() => vi.fn());
const mockSendCard = vi.hoisted(() => vi.fn());
const mockEditMessage = vi.hoisted(() => vi.fn());
const mockUploadImage = vi.hoisted(() => vi.fn());
const mockSendMessageWithMsgType = vi.hoisted(() => vi.fn());
const mockReplyMessageWithMsgType = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/chat-adapter-feishu', async (importOriginal) => {
  // Keep the REAL pure threadId decoder — only stub the network-touching parts.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createLarkAdapter: mockCreateLarkAdapter,
    downloadMediaFromRawMessage: mockDownloadMediaFromRawMessage,
    LarkApiClient: vi.fn().mockImplementation(() => ({
      editMessage: mockEditMessage,
      editCard: mockEditMessage,
      getMessage: mockGetMessage,
      replyCard: mockReplyCard,
      getTenantAccessToken: mockGetTenantAccessToken,
      getUserInfo: mockGetUserInfo,
      listMessages: mockListMessages,
      replyMessage: mockReplyMessage,
      replyMessageWithMsgType: mockReplyMessageWithMsgType,
      sendMessageWithMsgType: mockSendMessageWithMsgType,
      uploadImage: mockUploadImage,
    })),
  };
});

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

  it('returns undefined when downloadMediaFromRawMessage fails (per-raw, non-fatal)', async () => {
    mockDownloadMediaFromRawMessage.mockRejectedValue(new Error('helper crashed'));
    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        message_id: 'm',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'k' }),
      }),
    );
    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('downloads media from every merged raw (image sent before the @mention)', async () => {
    const buffer = Buffer.from('merged-image');
    mockDownloadMediaFromRawMessage.mockImplementation(async (_api: any, raw: any) =>
      raw.message_type === 'image' ? [{ buffer, mimeType: 'image/jpeg', name: 'image.jpg' }] : [],
    );

    const client = createClient();
    const message = {
      attachments: [{ type: 'image' }],
      id: 'm_text',
      raw: { message_id: 'm_text', message_type: 'text', content: '{"text":"hi"}' },
      raws: [
        { message_id: 'm_img', message_type: 'image', content: '{"image_key":"k"}' },
        { message_id: 'm_text', message_type: 'text', content: '{"text":"hi"}' },
      ],
      text: 'hi',
    } as any;
    const result = await client.extractFiles!(message);

    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: undefined },
    ]);
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

describe('FeishuWebhookClient.readRecentMessages', () => {
  const createClient = () =>
    new FeishuClientFactory().createClient(
      {
        applicationId: 'cli_test_app',
        credentials: { appSecret: 'sec', encryptKey: 'enc' },
        platform: 'feishu',
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );

  // Seconds-shaped, 1h in the future — newer than every sinceSec in these
  // tests (incl. the dynamic 24h default), so the watermark filter keeps it.
  const FRESH_TIME = String(Math.floor(Date.now() / 1000) + 3600);
  const msg = (id: string, openId: string, text: string, senderType = 'user') => ({
    body: { content: JSON.stringify({ text }) },
    create_time: FRESH_TIME,
    message_id: id,
    sender: { id: openId, sender_type: senderType },
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // The extractFiles describe's afterEach runs vi.restoreAllMocks(), which
    // wipes the LarkApiClient constructor's mockImplementation — re-arm it so
    // the client's lazy `api` getter builds instances with our method mocks.
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    vi.mocked(LarkApiClient).mockImplementation(
      () =>
        ({
          getMessage: mockGetMessage,
          getTenantAccessToken: mockGetTenantAccessToken,
          getUserInfo: mockGetUserInfo,
          listMessages: mockListMessages,
        }) as any,
    );
    mockGetUserInfo.mockImplementation(async (openId: string) =>
      openId === 'ou_a' ? { name: 'marin' } : { name: 'grimm' },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads chat container for plain group thread with a 24h startTime, oldest-first, skipping bots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    const nowSec = Math.floor(Date.now() / 1000);
    // API returns descending (newest-first) under sortOrder 'desc'.
    mockListMessages.mockResolvedValue({
      hasMore: false,
      items: [
        msg('om_3', 'ou_b', '应该是 dmflow-list 接口问题'),
        msg('om_2', 'ou_x', 'bot 中间发言', 'bot'),
        msg('om_1', 'ou_a', '线上数据有问题？'),
      ],
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 20);

    expect(mockListMessages).toHaveBeenCalledWith('oc_g', {
      containerType: 'chat',
      pageSize: 50,
      sortOrder: 'desc',
      startTime: String(nowSec - 24 * 60 * 60),
    });
    expect(result).toEqual([
      { author: 'marin', text: '线上数据有问题？' },
      { author: 'grimm', text: '应该是 dmflow-list 接口问题' },
    ]);
  });

  it('reads thread container for topic threadIds with the same startTime window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    mockListMessages.mockResolvedValue({ hasMore: false, items: [msg('om_1', 'ou_a', 'hello')] });

    await createClient().readRecentMessages!('feishu:group:oc_g:omt_t1', 20);

    expect(mockListMessages).toHaveBeenCalledWith('omt_t1', {
      containerType: 'thread',
      pageSize: 50,
      sortOrder: 'desc',
      startTime: undefined,
    });
  });

  it('passes a caller-provided sinceSec through as the startTime (watermark increment)', async () => {
    mockListMessages.mockResolvedValue({ hasMore: false, items: [msg('om_1', 'ou_a', 'hi')] });

    await createClient().readRecentMessages!('feishu:group:oc_g', 20, { sinceSec: 1755000000 });

    expect(mockListMessages).toHaveBeenCalledWith('oc_g', {
      containerType: 'chat',
      pageSize: 50,
      sortOrder: 'desc',
      startTime: '1755000000',
    });
  });

  it('drops messages older than sinceSec even when the API ignores start_time (thread container)', async () => {
    // Regression (2026-08-20): the thread container ignores `start_time` and
    // returns the whole tail — every wake-up re-injected the full history.
    // Items use list-API seconds; the ms-shaped item stays for compat.
    const old = { ...msg('om_old', 'ou_a', 'old news'), create_time: '1754000000' };
    const fresh = msg('om_new', 'ou_b', 'fresh');
    mockListMessages.mockResolvedValue({ hasMore: false, items: [old, fresh] });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g:omt_t1', 20, {
      sinceSec: 1755000000,
    });

    expect(result).toEqual([{ author: 'grimm', text: 'fresh' }]);
  });

  it('excludes the triggering mention — it is delivered as the run prompt, not history', async () => {
    // Regression (2026-08-20): the trigger @-mention itself is newer than the
    // watermark, so it came back in the injected block AND again as the user
    // prompt — duplicated content in the same turn.
    mockListMessages.mockResolvedValue({
      hasMore: false,
      items: [msg('om_trigger', 'ou_a', '这是什么文档'), msg('om_prev', 'ou_b', 'earlier chatter')],
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g:omt_t1', 20, {
      excludeMessageId: 'om_trigger',
    });

    expect(result).toEqual([{ author: 'grimm', text: 'earlier chatter' }]);
  });

  it('drops a mention of the bot itself but keeps human mentions', async () => {
    // Regression (2026-08-21): restored "@智能机器人" in injected history is
    // noise — the model doesn't know its own display name.
    const mockGetBotInfo = vi.fn(async () => ({ open_id: 'ou_bot' }));
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    const prevImpl = vi.mocked(LarkApiClient).getMockImplementation();
    vi.mocked(LarkApiClient).mockImplementation(
      () =>
        ({
          getBotInfo: mockGetBotInfo,
          getMessage: mockGetMessage,
          getTenantAccessToken: mockGetTenantAccessToken,
          getUserInfo: mockGetUserInfo,
          listMessages: mockListMessages,
        }) as any,
    );
    mockListMessages.mockResolvedValue({
      hasMore: false,
      items: [
        {
          ...msg('om_1', 'ou_a', '@_user_1 @_user_2 你看看'),
          mentions: [
            { id: { open_id: 'ou_bot' }, key: '@_user_1', name: '智能机器人' },
            { id: { open_id: 'ou_c' }, key: '@_user_2', name: 'grimm' },
          ],
        },
      ],
    });

    try {
      const result = await createClient().readRecentMessages!('feishu:group:oc_g:omt_t1', 20);
      expect(result).toEqual([{ author: 'marin', text: '@grimm 你看看' }]);
    } finally {
      if (prevImpl) vi.mocked(LarkApiClient).mockImplementation(prevImpl);
    }
  });

  it('keeps only the newest `limit` messages when the window has more', async () => {
    mockListMessages.mockResolvedValue({
      hasMore: false,
      // desc: newest first
      items: [
        msg('om_4', 'ou_b', 'fourth'),
        msg('om_3', 'ou_a', 'third'),
        msg('om_2', 'ou_b', 'second'),
        msg('om_1', 'ou_a', 'first'),
      ],
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 2, {
      sinceSec: 1755000000,
    });

    expect(result).toEqual([
      { author: 'marin', text: 'third' },
      { author: 'grimm', text: 'fourth' },
    ]);
  });

  it('fetches only ONE page (desc) even for old topics — no pagination loop', async () => {
    // sort_type=ByCreateTimeDesc makes page 1 the latest N messages, so an
    // old topic with thousands of messages needs no walk to reach its tail.
    mockListMessages.mockResolvedValue({
      hasMore: true, // more (older) pages exist — must NOT be fetched
      items: [msg('om_new2', 'ou_b', 'recent2'), msg('om_new1', 'ou_a', 'recent1')],
      pageToken: 'tok_2',
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g:omt_t1', 20, {
      sinceSec: 1755000000,
    });

    expect(mockListMessages).toHaveBeenCalledTimes(1);
    expect(mockListMessages).toHaveBeenCalledWith('omt_t1', {
      containerType: 'thread',
      pageSize: 50,
      sortOrder: 'desc',
      startTime: undefined,
    });
    expect(result).toEqual([
      { author: 'marin', text: 'recent1' },
      { author: 'grimm', text: 'recent2' },
    ]);
  });

  it('restores @-mention placeholders to real display names via mentions array', async () => {
    mockListMessages.mockResolvedValue({
      hasMore: false,
      // desc: newest first
      items: [
        {
          ...msg('om_2', 'ou_a', '谁摸鱼去了 @_user_1 @_all'),
          mentions: [{ key: '@_user_1', name: 'marun' }],
        },
        {
          ...msg('om_1', 'ou_a', '@_user_1 你怎么不在工位'),
          mentions: [{ key: '@_user_1', name: 'marun' }],
        },
      ],
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 20, {
      sinceSec: 1755000000,
    });

    expect(result).toEqual([
      { author: 'marin', text: '@marun 你怎么不在工位' },
      { author: 'marin', text: '谁摸鱼去了 @marun' },
    ]);
  });

  it('renders non-text history messages as labeled placeholders', async () => {
    mockListMessages.mockResolvedValue({
      hasMore: false,
      // desc: newest first
      items: [
        msg('om_3', 'ou_a', '看完说下结论'),
        {
          ...msg('om_2', 'ou_b', ''),
          body: { content: JSON.stringify({ file_key: 'file_v2_1', file_name: '工资表.xlsx' }) },
          msg_type: 'file',
        },
        {
          ...msg('om_1', 'ou_a', ''),
          body: { content: JSON.stringify({ image_key: 'img_v2_1' }) },
          msg_type: 'image',
        },
      ],
    });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 20, {
      sinceSec: 1755000000,
    });

    expect(result).toEqual([
      { author: 'marin', text: '[图片]' },
      { author: 'grimm', text: '[文件: 工资表.xlsx]' },
      { author: 'marin', text: '看完说下结论' },
    ]);
  });

  it('downloads window media as attachments (file sent before the separate @mention)', async () => {
    mockListMessages.mockResolvedValue({
      hasMore: false,
      // desc: newest first
      items: [
        msg('om_2', 'ou_a', '@bot 看下这个文件'),
        {
          ...msg('om_1', 'ou_a', ''),
          body: { content: JSON.stringify({ file_key: 'file_v2_1', file_name: 'doc.md' }) },
          msg_type: 'file',
        },
      ],
    });
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      { buffer: Buffer.from('md'), mimeType: 'text/markdown', name: 'doc.md', size: 2 },
    ]);

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 20, {
      sinceSec: 1755000000,
    });

    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message_type: 'file', message_id: 'om_1' }),
    );
    expect(result[0]).toMatchObject({ author: 'marin', text: '[文件: doc.md]' });
    expect(result[0].attachments).toHaveLength(1);
  });

  it('falls back to raw open_id when name lookup fails', async () => {
    mockGetUserInfo.mockRejectedValue(new Error('no permission'));
    mockListMessages.mockResolvedValue({ hasMore: false, items: [msg('om_1', 'ou_a', 'hi')] });

    const result = await createClient().readRecentMessages!('feishu:group:oc_g', 20);
    expect(result).toEqual([{ author: 'ou_a', text: 'hi' }]);
  });
});

describe('FeishuWebhookClient.resolveReference', () => {
  const createClient = () =>
    new FeishuClientFactory().createClient(
      {
        applicationId: 'cli_test_app',
        credentials: { appSecret: 'sec', encryptKey: 'enc' },
        platform: 'feishu',
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );

  const quoted = (over: Record<string, unknown> = {}) => ({
    body: { content: JSON.stringify({ text: '我发了两万！' }) },
    message_id: 'om_parent',
    msg_type: 'text',
    sender: { id: 'ou_a', sender_type: 'user' },
    ...over,
  });

  const replyMessage = (raw: Record<string, unknown>) => ({ raw }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserInfo.mockImplementation(async (openId: string) =>
      openId === 'ou_a' ? { name: 'marin' } : { name: 'grimm' },
    );
  });

  it('returns undefined when the message carries no parent_id', async () => {
    const result = await createClient().resolveReference!(replyMessage({ message_id: 'om_1' }));
    expect(mockGetMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('resolves the quoted text message with sender name and restored mentions', async () => {
    mockGetMessage.mockResolvedValue({
      items: [
        quoted({
          body: { content: JSON.stringify({ text: '@_user_1 发了多少' }) },
          mentions: [{ key: '@_user_1', name: 'grimm' }],
        }),
      ],
    });

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_parent' }),
    );

    expect(mockGetMessage).toHaveBeenCalledWith('om_parent');
    expect(result).toEqual({ sender: 'marin', text: '@grimm 发了多少' });
  });

  it('downloads quoted media as attachments and labels the text', async () => {
    mockGetMessage.mockResolvedValue({
      items: [
        quoted({
          body: { content: JSON.stringify({ file_key: 'file_v2_1', file_name: 'a.pdf' }) },
          msg_type: 'file',
        }),
      ],
    });
    mockDownloadMediaFromRawMessage.mockResolvedValue([
      { buffer: Buffer.from('x'), mimeType: 'application/pdf', name: 'a.pdf', size: 1 },
    ]);

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_parent' }),
    );

    expect(mockDownloadMediaFromRawMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message_type: 'file', message_id: 'om_parent' }),
    );
    expect(result?.text).toBe('[文件: a.pdf]');
    expect(result?.attachments).toHaveLength(1);
  });

  it('pulls the whole topic thread as surrounding when the quote lives in one', async () => {
    mockGetMessage.mockResolvedValue({ items: [quoted({ thread_id: 'omt_t1' })] });
    mockListMessages.mockResolvedValue({
      hasMore: false,
      items: [
        { ...quoted({}), body: { content: JSON.stringify({ text: '话题起始' }) } },
        {
          body: { content: JSON.stringify({ text: '话题回复' }) },
          message_id: 'om_2',
          msg_type: 'text',
          sender: { id: 'ou_b', sender_type: 'user' },
        },
      ],
    });

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_parent' }),
    );

    expect(mockListMessages).toHaveBeenCalledWith('omt_t1', {
      containerType: 'thread',
      pageSize: 50,
      pageToken: undefined,
    });
    expect(result?.surrounding).toEqual([{ author: 'grimm', text: '话题回复' }]);
  });

  it('degrades to undefined when the parent fetch fails', async () => {
    mockGetMessage.mockRejectedValue(new Error('gone'));

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_parent' }),
    );

    expect(result).toBeUndefined();
  });

  // Regression (2026-08-21): in feishu topic groups EVERY message replies to
  // the topic root, so parent_id is always set and the root quote was
  // re-injected on every turn as if the user had deliberately quoted it.
  // Only a reply to a NON-root message (thread_id ≠ parent id and the parent
  // not being the thread root itself) is a deliberate quote.
  it('skips the quote when the parent IS the topic root (topic-group default reply)', async () => {
    // Probe-verified payload shape (probe-thread-container-findings.md): in
    // topic replies root_id === parent_id === the root om_ message id.
    mockGetMessage.mockResolvedValue({
      items: [quoted({ message_id: 'om_root', thread_id: 'omt_t1' })],
    });

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_root', root_id: 'om_root' }),
    );

    expect(result).toBeUndefined();
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  // Regression (2026-08-21): the surrounding thread pull had NO sender filter
  // and no trigger exclusion — the bot's OWN replies and the triggering
  // @mention showed up as "group history" on every turn, duplicating content
  // already delivered as the run's own prompt/response.
  it('surrounding pull filters bot messages and the triggering @mention', async () => {
    mockGetMessage.mockResolvedValue({ items: [quoted({ thread_id: 'omt_t1' })] });
    mockListMessages.mockResolvedValue({
      hasMore: false,
      items: [
        { ...quoted({}), body: { content: JSON.stringify({ text: '话题起始' }) } },
        {
          body: { content: JSON.stringify({ text: '话题回复' }) },
          message_id: 'om_2',
          msg_type: 'text',
          sender: { id: 'ou_b', sender_type: 'user' },
        },
        // bot's own reply in the topic — must be dropped
        {
          body: { content: JSON.stringify({ text: '我是机器人的回复' }) },
          message_id: 'om_3',
          msg_type: 'text',
          sender: { id: 'ou_bot', sender_type: 'app' },
        },
      ],
    });

    const result = await createClient().resolveReference!(
      replyMessage({ message_id: 'om_1', parent_id: 'om_parent' }),
    );

    expect(result?.surrounding).toEqual([{ author: 'grimm', text: '话题回复' }]);
  });
});

describe('FeishuWebhookClient.getMessenger reply routing', () => {
  // Outbound reply-threading (ticket: feishu-reply-and-history): when the
  // caller knows the triggering platform message id, every outbound message
  // must go through the reply API so it lands inside the trigger's topic
  // thread instead of the group's main timeline.

  const createClient = () =>
    new FeishuClientFactory().createClient(
      {
        applicationId: 'cli_test_app',
        credentials: { appSecret: 'sec', encryptKey: 'enc' },
        platform: 'feishu',
        settings: {},
      },
      { appUrl: 'https://example.com' },
    );

  beforeEach(async () => {
    vi.clearAllMocks();
    // Earlier describes' afterEach (restoreAllMocks) wipes the constructor
    // mockImplementation — re-arm with the full method set.
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    vi.mocked(LarkApiClient).mockImplementation(
      () =>
        ({
          editMessage: mockEditMessage,
          editCard: mockEditMessage,
          getTenantAccessToken: mockGetTenantAccessToken,
          getUserInfo: mockGetUserInfo,
          listMessages: mockListMessages,
          replyCard: mockReplyCard,
          sendCard: mockSendCard,
          replyMessage: mockReplyMessage,
          replyMessageWithMsgType: mockReplyMessageWithMsgType,
          sendMessageWithMsgType: mockSendMessageWithMsgType,
          uploadImage: mockUploadImage,
        }) as any,
    );
    mockReplyCard.mockResolvedValue({ messageId: 'om_card_1', raw: {} });
    mockSendCard.mockResolvedValue({ messageId: 'om_card_send_1', raw: {} });
    mockReplyMessage.mockResolvedValue({ messageId: 'om_reply_1', raw: {} });
    mockReplyMessageWithMsgType.mockResolvedValue({ messageId: 'om_reply_img', raw: {} });
    mockEditMessage.mockResolvedValue({ raw: {} });
    mockUploadImage.mockResolvedValue({ image_key: 'img_key_1' });
  });

  it('replies to the trigger message and returns the reply message id when replyToMessageId is set', async () => {
    const messenger = createClient().getMessenger('feishu:group:oc_g', {
      replyToMessageId: 'om_trigger',
    });

    const result = await messenger.createMessage('**hello**');

    // Card is the primary reply transport (lark_md rendering); the plain-text
    // reply is only the fallback.
    expect(mockReplyCard).toHaveBeenCalledWith('om_trigger', '**hello**');
    expect(result).toEqual({ messageId: 'om_card_1' });
  });

  it('formatMarkdown is a pass-through so card markdown (image links) survives intact', () => {
    const client = createClient();
    const md = '![Generated image 1](https://s3.example/img.png?sig=abc)';
    expect(client.formatMarkdown!(md)).toBe(md);
  });

  it('propagates card reply failures (card-only transport, no text fallback)', async () => {
    mockReplyCard.mockRejectedValueOnce(new Error('card rejected'));
    const messenger = createClient().getMessenger('feishu:group:oc_g', {
      replyToMessageId: 'om_trigger',
    });

    await expect(messenger.createMessage('hello')).rejects.toThrow('card rejected');
  });

  it('maps status emojis to feishu emoji_type identifiers on replaceReaction', async () => {
    // Feishu reactions take EYES/THINKING/LIGHTNING identifiers, not the
    // Unicode emoji other platforms use — passing 👀 raw gets 231001.
    const mockAddReaction = vi.fn().mockResolvedValue(undefined);
    const { LarkApiClient } = await import('@lobechat/chat-adapter-feishu');
    vi.mocked(LarkApiClient).mockImplementation(
      () => ({ ...({} as any), addReaction: mockAddReaction }) as any,
    );

    const messenger = createClient().getMessenger('feishu:group:oc_g');
    await messenger.replaceReaction!('om_1', '👀', '🤔');
    await messenger.replaceReaction!('om_1', '🤔', '⚡');
    // Unknown emoji (not in the status-const map) — skipped, no API call.
    await messenger.replaceReaction!('om_1', '⚡', '🎉');

    expect(mockAddReaction).toHaveBeenCalledTimes(2);
    expect(mockAddReaction).toHaveBeenNthCalledWith(1, 'om_1', 'THINKING');
    expect(mockAddReaction).toHaveBeenNthCalledWith(2, 'om_1', 'OnIt');
  });

  it('sends a direct card to the chat when no replyToMessageId is given', async () => {
    const messenger = createClient().getMessenger('feishu:group:oc_g');

    const result = await messenger.createMessage('hi');

    expect(mockSendCard).toHaveBeenCalledWith('oc_g', 'hi');
    expect(mockReplyCard).not.toHaveBeenCalled();
    expect(result).toEqual({ messageId: 'om_card_send_1' });
  });

  it('routes attachment legs through the reply API too', async () => {
    const messenger = createClient().getMessenger('feishu:group:oc_g', {
      replyToMessageId: 'om_trigger',
    });

    const result = await messenger.createMessage({
      attachments: [
        {
          data: Buffer.from('image-bytes').toString('base64'),
          mimeType: 'image/png',
          name: 'pic.png',
          type: 'image',
        },
      ],
      content: 'see this',
    });

    // Text leg rides the reply API (card transport)...
    expect(mockReplyCard).toHaveBeenCalledWith('om_trigger', 'see this');
    // ...and so does the image leg (upload + reply-with-msg_type, never a
    // direct send into the main timeline).
    expect(mockUploadImage).toHaveBeenCalledTimes(1);
    expect(mockReplyMessageWithMsgType).toHaveBeenCalledWith(
      'om_trigger',
      'image',
      JSON.stringify({ image_key: 'img_key_1' }),
    );
    expect(mockSendMessageWithMsgType).not.toHaveBeenCalled();
    // The returned id is the LAST message sent — here the attachment reply.
    expect(result).toEqual({ messageId: 'om_reply_img' });
  });

  it('rejects when every requested attachment fails to deliver', async () => {
    mockUploadImage.mockRejectedValue(new Error('upload failed'));
    const messenger = createClient().getMessenger('feishu:group:oc_g', {
      replyToMessageId: 'om_trigger',
    });

    await expect(
      messenger.createMessage({
        attachments: [{ data: 'aGk=', name: 'img.png', type: 'image' }],
        content: '',
      }),
    ).rejects.toThrow('delivered no attachments');
  });

  it('keeps editMessage targeting the given message id (reply id flows through unchanged)', async () => {
    const messenger = createClient().getMessenger('feishu:group:oc_g', {
      replyToMessageId: 'om_trigger',
    });

    await messenger.editMessage('om_reply_1', 'updated text');

    expect(mockEditMessage).toHaveBeenCalledWith('om_reply_1', 'updated text');
  });
});
