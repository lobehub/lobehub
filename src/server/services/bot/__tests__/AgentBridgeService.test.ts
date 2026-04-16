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

vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isConfigured: false, isEnabled: false }),
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
    getMessenger: vi.fn().mockReturnValue({ triggerTyping: vi.fn() }),
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

  describe('resolveFiles dispatcher', () => {
    // The bridge no longer has its own attachment extraction logic — every
    // platform owns its own `client.extractFiles`. resolveFiles is just a
    // thin delegate. Per-platform attachment shape coverage lives in the
    // platform's own client.test.ts (e.g. telegram/client.test.ts,
    // wechat/client.test.ts, slack/client.test.ts, etc.).
    function callResolve(messageOverrides: Record<string, unknown>, client?: unknown) {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const message = { id: MESSAGE_ID, text: 'hi', ...messageOverrides } as any;
      return (service as any).resolveFiles(message, client) as Promise<
        Array<{ buffer?: Buffer; mimeType?: string; name?: string; size?: number; url?: string }>
      >;
    }

    it('delegates to client.extractFiles when the client implements it', async () => {
      const clientResult = [
        { buffer: Buffer.from('via-client'), mimeType: 'image/jpeg', name: 'pic.jpg' },
      ];
      const clientExtractFiles = vi.fn().mockResolvedValue(clientResult);

      const message = { id: MESSAGE_ID, text: 'hi', attachments: [] } as any;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const result = await (service as any).resolveFiles(message, {
        extractFiles: clientExtractFiles,
      });

      expect(clientExtractFiles).toHaveBeenCalledWith(message);
      expect(result).toEqual({ files: clientResult });
    });

    it('returns empty object when client is missing extractFiles method', async () => {
      // Defensive: a client that doesn't implement the optional method should
      // produce no files, not throw.
      const result = await callResolve({ attachments: [] }, { id: 'discord' });
      expect(result).toEqual({});
    });

    it('returns empty object when no client is passed', async () => {
      const result = await callResolve({ attachments: [] }, undefined);
      expect(result).toEqual({});
    });

    it('returns the client result as-is even when it is an empty array', async () => {
      const clientExtractFiles = vi.fn().mockResolvedValue([]);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      const message = { id: MESSAGE_ID, text: 'hi' } as any;
      const result = await (service as any).resolveFiles(message, {
        extractFiles: clientExtractFiles,
      });

      expect(clientExtractFiles).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ files: [] });
    });
  });
});
