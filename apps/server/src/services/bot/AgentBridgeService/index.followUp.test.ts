import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  createMessage,
  createThread,
  FAKE_DB,
  MESSAGE_ID,
  THREAD_ID,
  USER_ID,
} from './testUtils';

const mockGetUserSettings = vi.hoisted(() => vi.fn());
const mockExecAgent = vi.hoisted(() => vi.fn());
const mockFormatPrompt = vi.hoisted(() => vi.fn());
const mockGetPlatform = vi.hoisted(() => vi.fn());
const mockIsQueueAgentRuntimeEnabled = vi.hoisted(() => vi.fn());
const mockTopicFindById = vi.hoisted(() => vi.fn());
const mockIsRunningOperationAlive = vi.hoisted(() => vi.fn());
const mockDeferBotMessages = vi.hoisted(() => vi.fn());
const mockIsDeferredMessagesAvailable = vi.hoisted(() => vi.fn());

const mockReplayBot = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReplayMessenger = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ replayDeferredMessages: mockReplayBot }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: mockReplayMessenger }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      findById: mockTopicFindById,
      isRunningOperationAlive: mockIsRunningOperationAlive,
    };
  }),
}));

vi.mock('@/server/services/bot/deferredMessages', () => ({
  deferBotMessages: mockDeferBotMessages,
  isDeferredMessagesAvailable: mockIsDeferredMessagesAvailable,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return {
      getUserSettings: mockGetUserSettings,
    };
  }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: '',
    INTERNAL_APP_URL: '',
  },
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      execAgent: mockExecAgent,
    };
  }),
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
  buildBotSender: vi.fn((message: any, platform: string) => ({
    fullName: message?.author?.fullName,
    id: message?.author?.userId,
    platform,
  })),
  formatPrompt: mockFormatPrompt,
}));

vi.mock('@/server/services/bot/platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    platformRegistry: {
      getPlatform: mockGetPlatform,
    },
  };
});

const { AgentBridgeService } = await import('./index');

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
    // Default: the cached topic exists, belongs to the active agent, and is
    // fresh — so subscribed-message tests exercise the continue-topic path.
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      id: 'topic-1',
      updatedAt: new Date(),
    });
    mockIsRunningOperationAlive.mockResolvedValue(false);
    mockIsDeferredMessagesAvailable.mockReturnValue(true);
    mockDeferBotMessages.mockResolvedValue(true);
  });

  describe('follow-up while the topic is still running', () => {
    // Regression for WeChat "one image + one sentence": the two arrive as
    // separate messages, and in queue mode the second one landed while the
    // first run was still executing on the job queue. It lost the topic-start
    // reservation race and the user saw "Agent Execution Failed".
    const busyTopic = {
      agentId: 'agent-1',
      id: 'topic-1',
      metadata: { runningOperation: { assistantMessageId: 'a-1', operationId: 'op-running' } },
      updatedAt: new Date(),
    };
    const opts = () => ({
      agentId: 'agent-1',
      botContext: {
        applicationId: 'app-1',
        platform: 'wechat',
        platformThreadId: THREAD_ID,
      } as any,
      client: createClient(),
    });

    it('defers the message instead of starting a second run when the topic is busy', async () => {
      mockTopicFindById.mockResolvedValue(busyTopic);
      mockIsRunningOperationAlive.mockResolvedValue(true);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      const message = createMessage();

      await service.handleSubscribedMessage(thread, message, opts());

      expect(mockIsRunningOperationAlive).toHaveBeenCalledWith(
        FAKE_DB,
        busyTopic.metadata.runningOperation,
      );
      expect(mockDeferBotMessages).toHaveBeenCalledWith('app-1', THREAD_ID, [message]);
      expect(mockExecAgent).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('defers each source of a merged message so every raw survives the round-trip', async () => {
      mockTopicFindById.mockResolvedValue(busyTopic);
      mockIsRunningOperationAlive.mockResolvedValue(true);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const image = { id: 'img', raw: { item: 'image' }, text: '' } as any;
      const text = { id: 'txt', raw: { item: 'text' }, text: 'hi' } as any;
      const merged = { ...text, sourceMessages: [image, text] } as any;

      await service.handleSubscribedMessage(createThread({ topicId: 'topic-1' }), merged, opts());

      expect(mockDeferBotMessages).toHaveBeenCalledWith('app-1', THREAD_ID, [image, text]);
    });

    it.each([false, true])(
      'replays when completion wins the enqueue race (messenger=%s)',
      async (messenger) => {
        mockTopicFindById
          .mockResolvedValueOnce(busyTopic)
          .mockResolvedValueOnce({ ...busyTopic, metadata: {} });
        mockIsRunningOperationAlive.mockResolvedValue(true);
        const service = new AgentBridgeService(FAKE_DB, USER_ID);
        const options = opts();
        if (messenger) options.botContext.messengerInstallationKey = 'wechat:example';
        await service.handleSubscribedMessage(
          createThread({ topicId: 'topic-1' }),
          createMessage(),
          options,
        );
        expect(mockDeferBotMessages).toHaveBeenCalledTimes(1);
        expect(messenger ? mockReplayMessenger : mockReplayBot).toHaveBeenCalledWith(
          messenger ? 'wechat:example' : 'wechat',
          'app-1',
          THREAD_ID,
        );
        expect(mockExecAgent).not.toHaveBeenCalled();
      },
    );

    it('runs normally when the marker is stale (operation no longer alive)', async () => {
      mockTopicFindById.mockResolvedValue(busyTopic);
      mockIsRunningOperationAlive.mockResolvedValue(false);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleSubscribedMessage(
        createThread({ topicId: 'topic-1' }),
        createMessage(),
        opts(),
      );

      expect(mockDeferBotMessages).not.toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous behavior outside queue mode (SDK lock serializes runs)', async () => {
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      mockTopicFindById.mockResolvedValue(busyTopic);
      mockIsRunningOperationAlive.mockResolvedValue(true);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleSubscribedMessage(
        createThread({ topicId: 'topic-1' }),
        createMessage(),
        opts(),
      );

      expect(mockDeferBotMessages).not.toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });

    it('falls back to running when deferral is unavailable (no Redis)', async () => {
      mockTopicFindById.mockResolvedValue(busyTopic);
      mockIsRunningOperationAlive.mockResolvedValue(true);
      mockIsDeferredMessagesAvailable.mockReturnValue(false);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleSubscribedMessage(
        createThread({ topicId: 'topic-1' }),
        createMessage(),
        opts(),
      );

      expect(mockDeferBotMessages).not.toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });

    it('defers when the reservation still reports the topic busy (check/reserve race)', async () => {
      mockExecAgent.mockRejectedValueOnce(
        new Error('Topic topic-1 remained busy while starting operation agent-start-x'),
      );
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      const message = createMessage();

      await service.handleSubscribedMessage(thread, message, opts());

      expect(mockDeferBotMessages).toHaveBeenCalledWith('app-1', THREAD_ID, [message]);
      // No "Agent Execution Failed" for the user (only the start ack was posted).
      expect(thread.post).not.toHaveBeenCalledWith(
        expect.objectContaining({ markdown: expect.stringContaining('执行失败') }),
      );
      expect((AgentBridgeService as any).activeThreads.has(THREAD_ID)).toBe(false);
    });

    it('still surfaces the busy error when it cannot defer', async () => {
      mockIsDeferredMessagesAvailable.mockReturnValue(false);
      mockExecAgent.mockRejectedValueOnce(
        new Error('Topic topic-1 remained busy while starting operation agent-start-x'),
      );
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), opts());

      expect(mockDeferBotMessages).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith(
        expect.objectContaining({ markdown: expect.stringContaining('执行失败') }),
      );
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

    it('extracts files from every source of a merged message', async () => {
      // A merged message keeps only the LAST raw; the image that arrived one
      // message earlier must still be downloaded from its own raw.
      const image = { id: 'img', raw: { item: 'image' }, text: '' } as any;
      const text = { id: 'txt', raw: { item: 'text' }, text: 'hi' } as any;
      const merged = { ...text, sourceMessages: [image, text] } as any;
      const clientExtractFiles = vi
        .fn()
        .mockImplementation(async (m: any) =>
          m.id === 'img'
            ? { files: [{ buffer: Buffer.from('jpg'), name: 'image.jpg' }], warnings: ['w1'] }
            : undefined,
        );
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      const result = await (service as any).resolveFiles(merged, {
        extractFiles: clientExtractFiles,
      });

      expect(clientExtractFiles).toHaveBeenCalledTimes(2);
      expect(clientExtractFiles).toHaveBeenNthCalledWith(1, image);
      expect(clientExtractFiles).toHaveBeenNthCalledWith(2, text);
      expect(result).toEqual({
        files: [{ buffer: Buffer.from('jpg'), name: 'image.jpg' }],
        warnings: ['w1'],
      });
    });
  });
  describe('startup failure reporting', () => {
    // A hetero dispatch failure (device offline, no bound device, sandbox spawn
    // rejected) finalizes the run through CompletionLifecycle — which fires the
    // `bot-completion` hook — AND returns `success: false`. Reporting it here as
    // well put two error messages in the same IM thread (#19676 follow-up).
    const createProgressThread = () => {
      const edit = vi.fn().mockResolvedValue(undefined);
      const thread = createThread();
      thread.post = vi.fn().mockResolvedValue({ edit, id: 'progress-msg-1' });
      return { edit, thread };
    };

    const failedStartup = (extra?: Record<string, unknown>) => ({
      assistantMessageId: 'assistant-msg-1',
      createdAt: new Date().toISOString(),
      error: 'DEVICE_NOT_FOUND (HTTP 404)',
      operationId: 'op-1',
      success: false,
      topicId: 'topic-1',
      ...extra,
    });

    it('stays silent when the terminal lifecycle already reported the failure', async () => {
      mockExecAgent.mockResolvedValue(failedStartup({ terminalReported: true }));
      const { edit, thread } = createProgressThread();
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      // Only the "Processing..." placeholder — the completion callback owns the
      // error reply and edits that same message.
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(edit).not.toHaveBeenCalled();
    });

    it('reports a startup failure that reached no completion hook', async () => {
      mockExecAgent.mockResolvedValue(failedStartup());
      const { edit, thread } = createProgressThread();
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(edit).toHaveBeenCalledTimes(1);
      expect(edit.mock.calls[0][0].markdown).toContain('Operation ID');
    });
  });
});
