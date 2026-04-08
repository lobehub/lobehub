import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserSettings = vi.hoisted(() => vi.fn());
const mockExecAgent = vi.hoisted(() => vi.fn());
const mockFormatPrompt = vi.hoisted(() => vi.fn());
const mockGetPlatform = vi.hoisted(() => vi.fn());
const mockIsQueueAgentRuntimeEnabled = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mockGetUserSettings,
  })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: '',
    INTERNAL_APP_URL: '',
  },
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
  })),
}));

vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: mockIsQueueAgentRuntimeEnabled,
}));

vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn(),
}));

vi.mock('@/server/services/bot/formatPrompt', () => ({
  formatPrompt: mockFormatPrompt,
}));

vi.mock('@/server/services/bot/platforms', () => ({
  platformRegistry: {
    getPlatform: mockGetPlatform,
  },
}));

const { AgentBridgeService } = await import('../AgentBridgeService');

const FAKE_DB = {} as any;
const USER_ID = 'user-123';
const THREAD_ID = 'discord:guild-1:channel-1:thread-1';
const MESSAGE_ID = 'msg-123';

function createThread(stateValue?: Record<string, unknown>) {
  const post = vi
    .fn()
    .mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined), id: 'progress-msg-1' });

  return {
    adapter: {
      addReaction: vi.fn().mockResolvedValue(undefined),
      decodeThreadId: vi.fn().mockReturnValue({}),
      fetchThread: vi.fn(),
      removeReaction: vi.fn().mockResolvedValue(undefined),
    },
    id: THREAD_ID,
    post,
    setState: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    state: Promise.resolve(stateValue),
    subscribe: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMessage() {
  return {
    attachments: [{}],
    author: { userName: 'tester' },
    id: MESSAGE_ID,
    text: 'hello world',
  } as any;
}

function createClient() {
  return {
    createAdapter: vi.fn(),
    extractChatId: vi.fn(),
    getMessenger: vi.fn(),
    id: 'discord',
    parseMessageId: vi.fn(),
    shouldSubscribe: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
  } as any;
}

describe('AgentBridgeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAgent.mockResolvedValue({
      assistantMessageId: 'assistant-msg-1',
      createdAt: new Date().toISOString(),
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    mockFormatPrompt.mockReturnValue('formatted prompt');
    mockGetPlatform.mockReturnValue({ id: 'discord', supportsMessageEdit: true });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });
    mockIsQueueAgentRuntimeEnabled.mockReturnValue(true);
  });

  it('calls execAgent with hooks in queue mode for mention', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    const message = createMessage();
    const client = createClient();

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    // execAgent should be called with hooks (afterStep + onComplete)
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        hooks: expect.arrayContaining([
          expect.objectContaining({ id: 'bot-step-progress', type: 'afterStep' }),
          expect.objectContaining({ id: 'bot-completion', type: 'onComplete' }),
        ]),
      }),
    );
  });

  it('calls execAgent with hooks in queue mode for subscribed message', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread({ topicId: 'topic-1' });
    const message = createMessage();
    const client = createClient();

    await service.handleSubscribedMessage(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    // execAgent should be called with hooks containing webhook config
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        hooks: expect.arrayContaining([
          expect.objectContaining({
            id: 'bot-step-progress',
            type: 'afterStep',
            webhook: expect.objectContaining({
              body: expect.objectContaining({ type: 'step', platformThreadId: THREAD_ID }),
            }),
          }),
          expect.objectContaining({
            id: 'bot-completion',
            type: 'onComplete',
            webhook: expect.objectContaining({
              body: expect.objectContaining({ type: 'completion', platformThreadId: THREAD_ID }),
            }),
          }),
        ]),
      }),
    );
  });

  describe('activeThreads cleanup on side-effect failure', () => {
    // Regression test for the "already has an active execution" lockup:
    // a transient network error from `thread.startTyping()` (or any other
    // pre-execution side effect) used to escape the handler before the
    // try/finally cleanup, leaving the thread permanently in `activeThreads`.
    // After the fix, side-effect errors are swallowed AND the active flag
    // is released no matter what.

    it('handleSubscribedMessage releases activeThreads when startTyping throws', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      thread.startTyping = vi
        .fn()
        .mockRejectedValue(new Error('Network error calling Telegram sendChatAction'));
      const message = createMessage();
      const client = createClient();

      await service.handleSubscribedMessage(thread, message, {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      // The error must NOT escape and the active flag must be cleared.
      // (startTyping is called twice: once at handler entry as a UX hint,
      // and once inside executeWithWebhooks — both must be safely swallowed.)
      expect(thread.startTyping).toHaveBeenCalled();
      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);
    });

    it('handleSubscribedMessage releases activeThreads when addReaction throws', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      thread.adapter.addReaction = vi
        .fn()
        .mockRejectedValue(new Error('Network error calling Telegram setMessageReaction'));
      const message = createMessage();
      const client = createClient();

      await service.handleSubscribedMessage(thread, message, {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);
    });

    it('handleMention releases activeThreads when subscribe throws', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      thread.subscribe = vi.fn().mockRejectedValue(new Error('subscribe network down'));
      const message = createMessage();
      const client = createClient();

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(thread.subscribe).toHaveBeenCalledTimes(1);
      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);
    });

    it('handleMention releases activeThreads when startTyping throws', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      thread.startTyping = vi.fn().mockRejectedValue(new Error('startTyping network down'));
      const message = createMessage();
      const client = createClient();

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(thread.startTyping).toHaveBeenCalled();
      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);
    });

    it('back-to-back messages on the same thread are not blocked after a side-effect failure', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const client = createClient();

      // First message: startTyping throws → should NOT lock the thread.
      const thread1 = createThread({ topicId: 'topic-1' });
      thread1.startTyping = vi.fn().mockRejectedValue(new Error('boom'));
      await service.handleSubscribedMessage(thread1, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });
      // Sanity: the active flag must have been released after thread1.
      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);

      // Second message on the same thread: must be processed, NOT skipped.
      // (If the thread were locked, the handler would early-return without
      // ever calling thread2.startTyping.)
      const thread2 = createThread({ topicId: 'topic-1' });
      await service.handleSubscribedMessage(thread2, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(thread2.startTyping).toHaveBeenCalled();
    });
  });

  describe('extractFiles', () => {
    function callExtract(messageOverrides: Record<string, unknown>, client?: unknown) {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const message = { id: MESSAGE_ID, text: 'hi', ...messageOverrides } as any;
      return (service as any).extractFiles(message, client) as Promise<
        Array<{ buffer?: Buffer; mimeType?: string; name?: string; size?: number; url: string }>
      >;
    }

    it('uses the pre-downloaded buffer when present (WeChat / Feishu inbound)', async () => {
      const buffer = Buffer.from('wechat-image');
      const result = await callExtract({
        attachments: [
          { buffer, mimeType: 'image/jpeg', name: 'pic.jpg', size: buffer.length, type: 'image' },
        ],
      });
      expect(result).toEqual([
        { buffer, mimeType: 'image/jpeg', name: 'pic.jpg', size: buffer.length, url: '' },
      ]);
    });

    it('invokes fetchData for token-protected attachments (Telegram / Slack)', async () => {
      const buffer = Buffer.from('telegram-voice');
      const fetchData = vi.fn().mockResolvedValue(buffer);
      const result = await callExtract({
        attachments: [{ fetchData, mimeType: 'audio/ogg', name: 'voice.ogg', type: 'audio' }],
      });
      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { buffer, mimeType: 'audio/ogg', name: 'voice.ogg', size: undefined, url: '' },
      ]);
    });

    it('infers mimeType + name for Telegram photos that omit both fields', async () => {
      // Telegram's Bot API does not return mime_type or file_name for `photo`
      // payloads (they are always JPEG by spec), so the chat-adapter emits
      // attachments with only `type: "image"`. Without inference these would
      // fall through to ingestAttachment as application/octet-stream and end
      // up in fileList instead of imageList — vision models would never see
      // the photo. Verify we backfill to image/jpeg + image.jpg.
      const buffer = Buffer.from('telegram-photo-bytes');
      const fetchData = vi.fn().mockResolvedValue(buffer);
      const result = await callExtract({
        attachments: [{ fetchData, size: buffer.length, type: 'image' }],
      });
      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: buffer.length, url: '' },
      ]);
    });

    it('infers mimeType + name for type-only video and audio attachments', async () => {
      const videoBuffer = Buffer.from('vid');
      const audioBuffer = Buffer.from('aud');
      const result = await callExtract({
        attachments: [
          { fetchData: vi.fn().mockResolvedValue(videoBuffer), type: 'video' },
          { fetchData: vi.fn().mockResolvedValue(audioBuffer), type: 'audio' },
        ],
      });
      expect(result).toEqual([
        {
          buffer: videoBuffer,
          mimeType: 'video/mp4',
          name: 'video.mp4',
          size: undefined,
          url: '',
        },
        {
          buffer: audioBuffer,
          mimeType: 'audio/ogg',
          name: 'audio.ogg',
          size: undefined,
          url: '',
        },
      ]);
    });

    it('does not overwrite an explicit mimeType / name when type is also set', async () => {
      const buffer = Buffer.from('explicit');
      const result = await callExtract({
        attachments: [
          {
            fetchData: vi.fn().mockResolvedValue(buffer),
            mimeType: 'image/png',
            name: 'screenshot.png',
            type: 'image',
          },
        ],
      });
      expect(result).toEqual([
        { buffer, mimeType: 'image/png', name: 'screenshot.png', size: undefined, url: '' },
      ]);
    });

    it('falls back to client.refetchAttachment when attachment has no buffer/fetchData/url', async () => {
      // Reproduces the post-Redis state for Telegram photos: the chat-sdk's
      // `Message.toJSON` strips `fetchData` (functions are not JSON-serializable),
      // and Telegram photos have no public URL, so by the time the message
      // reaches us after a debounce round-trip, all three data sources are gone
      // — we only have `type`, `size`, and the original `raw` payload with file_id.
      const buffer = Buffer.from('telegram-photo-bytes');
      const refetchAttachment = vi.fn().mockResolvedValue(buffer);
      const result = await callExtract(
        {
          attachments: [{ size: 16_388, type: 'image' }],
          raw: {
            chat: { id: 7019597964 },
            message_id: 158,
            photo: [
              { file_id: 'tg-photo-small', height: 90, width: 90 },
              { file_id: 'tg-photo-large', height: 1280, width: 1280 },
            ],
          },
        },
        { refetchAttachment },
      );
      expect(refetchAttachment).toHaveBeenCalledWith({
        index: 0,
        raw: expect.objectContaining({ photo: expect.any(Array) }),
        type: 'image',
      });
      expect(result).toEqual([
        {
          buffer,
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          size: 16_388,
          url: '',
        },
      ]);
    });

    it('drops the attachment if client.refetchAttachment returns undefined', async () => {
      const refetchAttachment = vi.fn().mockResolvedValue(undefined);
      const result = await callExtract(
        { attachments: [{ size: 100, type: 'image' }], raw: {} },
        { refetchAttachment },
      );
      expect(refetchAttachment).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });

    it('skips the attachment without throwing when client.refetchAttachment errors', async () => {
      const refetchAttachment = vi.fn().mockRejectedValue(new Error('telegram getFile 404'));
      const goodBuffer = Buffer.from('good');
      const result = await callExtract(
        {
          attachments: [
            { size: 100, type: 'image' },
            { fetchData: vi.fn().mockResolvedValue(goodBuffer), type: 'image' },
          ],
          raw: {},
        },
        { refetchAttachment },
      );
      // First attachment fails refetch and is dropped; second still resolves.
      expect(result).toEqual([
        {
          buffer: goodBuffer,
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          size: undefined,
          url: '',
        },
      ]);
    });

    it('does not call refetchAttachment when buffer/fetchData/url is already present', async () => {
      const refetchAttachment = vi.fn();
      await callExtract(
        {
          attachments: [
            { buffer: Buffer.from('x'), type: 'image' },
            { fetchData: vi.fn().mockResolvedValue(Buffer.from('y')), type: 'image' },
            { type: 'image', url: 'https://cdn.example/z.png' },
          ],
        },
        { refetchAttachment },
      );
      expect(refetchAttachment).not.toHaveBeenCalled();
    });

    it('falls back to public url when neither buffer nor fetchData is provided (Discord / QQ)', async () => {
      const result = await callExtract({
        attachments: [
          {
            mimeType: 'image/png',
            name: 'discord.png',
            size: 4321,
            type: 'image',
            url: 'https://cdn.discord.example/discord.png',
          },
        ],
      });
      expect(result).toEqual([
        {
          mimeType: 'image/png',
          name: 'discord.png',
          size: 4321,
          url: 'https://cdn.discord.example/discord.png',
        },
      ]);
    });

    it('prefers fetchData over url so Slack-style auth-required URLs are not blindly fetched', async () => {
      const buffer = Buffer.from('slack-file');
      const fetchData = vi.fn().mockResolvedValue(buffer);
      const result = await callExtract({
        attachments: [
          {
            fetchData,
            mimeType: 'application/pdf',
            name: 'doc.pdf',
            size: 9999,
            type: 'file',
            url: 'https://files.slack.com/private/doc.pdf',
          },
        ],
      });
      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(result?.[0]).toMatchObject({ buffer, mimeType: 'application/pdf', url: '' });
    });

    it('skips a single failing attachment without dropping the others', async () => {
      const goodBuffer = Buffer.from('ok');
      const result = await callExtract({
        attachments: [
          { fetchData: vi.fn().mockRejectedValue(new Error('boom')), name: 'bad.bin' },
          { fetchData: vi.fn().mockResolvedValue(goodBuffer), name: 'good.bin' },
        ],
      });
      expect(result).toEqual([
        { buffer: goodBuffer, mimeType: undefined, name: 'good.bin', size: undefined, url: '' },
      ]);
    });

    it('returns undefined when no attachments are present', async () => {
      const result = await callExtract({ attachments: [] });
      expect(result).toBeUndefined();
    });

    it('still picks up referenced (quoted) message attachments via raw payload', async () => {
      const result = await callExtract({
        attachments: [],
        raw: {
          referenced_message: {
            attachments: [
              {
                content_type: 'image/png',
                filename: 'quoted.png',
                size: 100,
                url: 'https://cdn.discord.example/quoted.png',
              },
            ],
          },
        },
      });
      expect(result).toEqual([
        {
          mimeType: 'image/png',
          name: 'quoted.png',
          size: 100,
          url: 'https://cdn.discord.example/quoted.png',
        },
      ]);
    });
  });
});
