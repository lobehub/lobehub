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

  describe('extractFiles', () => {
    function callExtract(messageOverrides: Record<string, unknown>) {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const message = { id: MESSAGE_ID, text: 'hi', ...messageOverrides } as any;
      return (service as any).extractFiles(message) as Promise<
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
