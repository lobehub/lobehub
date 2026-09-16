import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserSettings = vi.hoisted(() => vi.fn());
const mockExecAgent = vi.hoisted(() => vi.fn());
const mockInterruptTask = vi.hoisted(() => vi.fn());
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
      interruptTask: mockInterruptTask,
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

const { AgentBridgeService } = await import('../AgentBridgeService');
const { AiAgentService } = await import('@/server/services/aiAgent');

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

function createDraftMessenger(overrides: Record<string, unknown> = {}) {
  return {
    clearDraft: vi.fn().mockResolvedValue(undefined),
    createDraft: vi.fn().mockResolvedValue('draft-42'),
    createMessage: vi.fn().mockResolvedValue(undefined),
    renewDraft: vi.fn().mockResolvedValue(undefined),
    setDraftOperation: vi.fn().mockResolvedValue(false),
    triggerTyping: vi.fn(),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function localExecResult(overrides: Record<string, unknown> = {}) {
  return {
    assistantMessageId: 'assistant-msg-1',
    createdAt: new Date().toISOString(),
    operationId: 'op-1',
    success: true,
    topicId: 'topic-1',
    ...overrides,
  };
}

describe('AgentBridgeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AgentBridgeService.clearActiveThread(THREAD_ID);
    mockExecAgent.mockResolvedValue({
      assistantMessageId: 'assistant-msg-1',
      createdAt: new Date().toISOString(),
      operationId: 'op-1',
      topicId: 'topic-1',
    });
    mockInterruptTask.mockResolvedValue({ success: true });
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

  it('passes the /mode thread-state override to execAgent as toolModeOverride', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread({ toolMode: 'chat' });
    const message = createMessage();
    const client = createClient();

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ toolModeOverride: 'chat' }),
    );
  });

  it('forwards toolModeOverride on the subscribed-message (continue topic) path too', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread({ toolMode: 'agent', topicId: 'topic-1' });
    const message = createMessage();
    const client = createClient();

    await service.handleSubscribedMessage(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({ appContext: { topicId: 'topic-1' }, toolModeOverride: 'agent' }),
    );
  });

  it('leaves toolModeOverride unset when the conversation never used /mode', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    const message = createMessage();
    const client = createClient();

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(mockExecAgent.mock.calls[0][0].toolModeOverride).toBeUndefined();
  });

  describe('current-conversation injection', () => {
    it('injects the platform + channelId the message tool needs into botPlatformContext', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      const message = createMessage();
      const client = createClient();
      // Feishu/Lark threadIds are `lark:group:oc_xxx`; the client's own decoder
      // is what turns that into the `oc_xxx` the message service accepts.
      client.extractChatId.mockReturnValue('oc_chat_1');
      mockGetPlatform.mockReturnValue({ id: 'lark', name: 'Lark', supportsMessageEdit: true });

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platform: 'lark', platformThreadId: 'lark:group:oc_chat_1' } as any,
        client,
      });

      expect(client.extractChatId).toHaveBeenCalledWith('lark:group:oc_chat_1');
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          botPlatformContext: expect.objectContaining({
            currentChannel: { id: 'oc_chat_1', platformId: 'lark' },
          }),
        }),
      );
    });

    it('prefers extractConversationId, so a platform can decline for an unscopable thread', async () => {
      // Slack: `slack:C1:1700.1` is a reply thread, but readMessages can only
      // read the channel — advertising `C1` as "this conversation" would be a lie.
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const client = createClient() as any;
      client.extractChatId.mockReturnValue('C1');
      client.extractConversationId = vi.fn().mockReturnValue(undefined);
      mockGetPlatform.mockReturnValue({ id: 'slack', name: 'Slack', supportsMessageEdit: true });

      await service.handleMention(createThread(), createMessage(), {
        agentId: 'agent-1',
        botContext: { platform: 'slack', platformThreadId: 'slack:C1:1700.1' } as any,
        client,
      });

      expect(client.extractConversationId).toHaveBeenCalledWith('slack:C1:1700.1');
      expect(mockExecAgent.mock.calls[0][0].botPlatformContext.currentChannel).toBeUndefined();
    });

    it('omits currentChannel when the platform client cannot decode the threadId', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      const message = createMessage();
      const client = createClient();
      client.extractChatId.mockImplementation(function () {
        throw new Error('malformed threadId');
      });
      mockGetPlatform.mockReturnValue({ id: 'lark', name: 'Lark', supportsMessageEdit: true });

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platform: 'lark', platformThreadId: 'garbage' } as any,
        client,
      });

      // The run still completes — losing the shortcut must never break the reply.
      expect(mockExecAgent).toHaveBeenCalled();
      expect(mockExecAgent.mock.calls[0][0].botPlatformContext.currentChannel).toBeUndefined();
    });
  });

  it('constructs AiAgentService with workspaceId for workspace bot runs', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID, 'workspace-1');
    const thread = createThread();
    const message = createMessage();
    const client = createClient();

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(AiAgentService).toHaveBeenCalledWith(FAKE_DB, USER_ID, {
      workspaceId: 'workspace-1',
    });
    expect(mockExecAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        hooks: expect.arrayContaining([
          expect.objectContaining({
            webhook: expect.objectContaining({
              body: expect.objectContaining({ workspaceId: 'workspace-1' }),
            }),
          }),
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

  it('keeps a local native draft when final delivery fails', async () => {
    mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
    const clearDraft = vi.fn().mockResolvedValue(undefined);
    const sendFinalMessage = vi.fn().mockRejectedValue(new Error('Telegram unavailable'));
    const client = createClient();
    client.getMessenger.mockReturnValue({
      clearDraft,
      createDraft: vi.fn().mockResolvedValue('draft-42'),
      createMessage: sendFinalMessage,
      triggerTyping: vi.fn(),
    });
    mockExecAgent.mockImplementationOnce(async (params: any) => {
      const completion = params.hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
      queueMicrotask(() => {
        void completion!.handler({
          attachments: [],
          lastAssistantContent: 'Final answer',
          reason: 'completed',
        });
      });
      return {
        assistantMessageId: 'assistant-msg-1',
        createdAt: new Date().toISOString(),
        operationId: 'op-1',
        success: true,
        topicId: 'topic-1',
      };
    });
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    thread.isDM = true;

    await service.handleMention(thread, createMessage(), {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(sendFinalMessage).toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('does not fail the run when native draft error delivery fails at startup', async () => {
    const sendErrorMessage = vi.fn().mockRejectedValue(new Error('Telegram unavailable'));
    const client = createClient();
    client.getMessenger.mockReturnValue({
      createDraft: vi.fn().mockResolvedValue('draft-42'),
      createMessage: sendErrorMessage,
      triggerTyping: vi.fn(),
    });
    mockExecAgent.mockRejectedValueOnce(new Error('startup boom'));
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    thread.isDM = true;

    await expect(
      service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      }),
    ).resolves.toBeUndefined();

    expect(sendErrorMessage).toHaveBeenCalled();
  });

  describe('native draft local-mode delivery', () => {
    const runLocalMention = async (
      messenger: ReturnType<typeof createDraftMessenger>,
      extra?: { displayToolCalls?: boolean },
    ) => {
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      thread.isDM = true;
      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
        ...extra,
      });
      return { thread };
    };

    const runWithHooks = async (
      messenger: ReturnType<typeof createDraftMessenger>,
      fire: (hooks: any[]) => void | Promise<void>,
      extra?: { displayToolCalls?: boolean; execOverrides?: Record<string, unknown> },
    ) => {
      mockExecAgent.mockImplementationOnce(async (params: any) => {
        queueMicrotask(() => {
          void fire(params.hooks);
        });
        return localExecResult(extra?.execOverrides);
      });
      return runLocalMention(messenger, extra);
    };

    it('falls back to the progress message when native draft creation fails', async () => {
      const messenger = createDraftMessenger({
        createDraft: vi.fn().mockRejectedValue(new Error('draft unavailable')),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(true);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(thread.post).toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalled();
    });

    it('interrupts a queued run when the native draft already recorded Stop', async () => {
      mockExecAgent.mockResolvedValueOnce(localExecResult());
      const messenger = createDraftMessenger({
        setDraftOperation: vi.fn().mockResolvedValue(true),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(true);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createDraft).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ durable: true }),
      );
      expect(messenger.setDraftOperation).toHaveBeenCalledWith('draft-42', 'op-1');
      expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-1' });
    });

    it('fails the webhook handoff when deferred stop interrupt fails', async () => {
      mockExecAgent.mockResolvedValueOnce(localExecResult());
      mockInterruptTask.mockResolvedValueOnce({ success: false });
      const messenger = createDraftMessenger({
        setDraftOperation: vi.fn().mockResolvedValue(true),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(true);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await expect(
        service.handleMention(thread, createMessage(), {
          agentId: 'agent-1',
          botContext: { platformThreadId: THREAD_ID } as any,
          client,
        }),
      ).rejects.toThrow('Failed to interrupt operation op-1');

      expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-1' });
    });

    it('renews a native draft on local-mode steps when tool details are hidden', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(messenger, async (hooks) => {
        const step = hooks.find((hook: { id: string }) => hook.id === 'bot-step-progress');
        await step.handler({ shouldContinue: true, stepType: 'call_llm' });
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({ lastAssistantContent: 'done', reason: 'completed' });
      });

      expect(messenger.renewDraft).toHaveBeenCalledWith('draft-42');
      expect(messenger.updateDraft).not.toHaveBeenCalled();
    });

    it('keeps going when local-mode draft renewal fails', async () => {
      const messenger = createDraftMessenger({
        renewDraft: vi.fn().mockRejectedValue(new Error('renew failed')),
      });
      await runWithHooks(messenger, async (hooks) => {
        const step = hooks.find((hook: { id: string }) => hook.id === 'bot-step-progress');
        await step.handler({ shouldContinue: true, stepType: 'call_llm' });
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({ lastAssistantContent: 'done', reason: 'completed' });
      });

      expect(messenger.renewDraft).toHaveBeenCalledWith('draft-42');
    });

    it('streams local-mode progress into the native draft', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(
        messenger,
        async (hooks) => {
          const step = hooks.find((hook: { id: string }) => hook.id === 'bot-step-progress');
          await step.handler({
            content: 'Working…',
            shouldContinue: true,
            stepType: 'call_llm',
          });
          const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
          await completion.handler({ lastAssistantContent: 'done', reason: 'completed' });
        },
        { displayToolCalls: true },
      );

      expect(messenger.updateDraft).toHaveBeenCalledWith('draft-42', expect.any(String));
    });

    it('swallows native draft progress update failures', async () => {
      const messenger = createDraftMessenger({
        updateDraft: vi.fn().mockRejectedValue(new Error('update failed')),
      });
      await runWithHooks(
        messenger,
        async (hooks) => {
          const step = hooks.find((hook: { id: string }) => hook.id === 'bot-step-progress');
          await step.handler({
            content: 'Working…',
            shouldContinue: true,
            stepType: 'call_llm',
          });
          const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
          await completion.handler({ lastAssistantContent: 'done', reason: 'completed' });
        },
        { displayToolCalls: true },
      );

      expect(messenger.updateDraft).toHaveBeenCalled();
    });

    it('finalizes a native draft on local-mode agent error', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({
          errorMessage: 'model exploded',
          errorType: 'unknown',
          operationId: 'op-1',
          reason: 'error',
        });
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('posts a fallback when local-mode error draft delivery fails', async () => {
      const messenger = createDraftMessenger({
        createMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
      });
      const { thread } = await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({
          errorMessage: 'model exploded',
          errorType: 'unknown',
          operationId: 'op-1',
          reason: 'error',
        });
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith({ markdown: expect.any(String) });
      expect(messenger.clearDraft).not.toHaveBeenCalled();
    });

    it('finalizes a native draft when the run is interrupted', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({ reason: 'interrupted' });
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('posts a fallback when interrupted draft delivery fails', async () => {
      const messenger = createDraftMessenger({
        createMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
      });
      const { thread } = await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({ reason: 'interrupted' });
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith({ markdown: expect.any(String) });
      expect(messenger.clearDraft).not.toHaveBeenCalled();
    });

    it('posts native draft chunks and attachments then clears the draft', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({
          attachments: [
            {
              fetchUrl: 'https://cdn.example.com/foo.png',
              mimeType: 'image/png',
              name: 'foo.png',
              type: 'image',
            },
          ],
          lastAssistantContent: 'Final answer',
          reason: 'completed',
        });
      });

      expect(messenger.createMessage).toHaveBeenCalledWith({
        attachments: [
          expect.objectContaining({
            fetchUrl: 'https://cdn.example.com/foo.png',
            type: 'image',
          }),
        ],
        content: expect.stringContaining('Final answer'),
      });
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('clears the native draft when completion has no content', async () => {
      const messenger = createDraftMessenger();
      await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({ attachments: [], reason: 'completed' });
      });

      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('finalizes a native draft when local-mode startup reports failure', async () => {
      const messenger = createDraftMessenger();
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      mockExecAgent.mockResolvedValueOnce(
        localExecResult({ error: 'provider down', success: false }),
      );
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('posts a fallback when local-mode startup failure draft delivery fails', async () => {
      const messenger = createDraftMessenger({
        createMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      mockExecAgent.mockResolvedValueOnce(
        localExecResult({ error: 'provider down', success: false }),
      );
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith({ markdown: expect.any(String) });
      expect(messenger.clearDraft).not.toHaveBeenCalled();
    });

    it('finalizes a native draft when local-mode startup aborts', async () => {
      const messenger = createDraftMessenger();
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      const abortError = new Error('Execution stopped before startup.');
      abortError.name = 'AbortError';
      mockExecAgent.mockRejectedValueOnce(abortError);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('posts a fallback when startup abort draft delivery fails', async () => {
      const messenger = createDraftMessenger({
        createMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      const abortError = new Error('Execution stopped before startup.');
      abortError.name = 'AbortError';
      mockExecAgent.mockRejectedValueOnce(abortError);
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith({ markdown: expect.any(String) });
      expect(messenger.clearDraft).not.toHaveBeenCalled();
    });

    it('finalizes a native draft on a generic local-mode startup error', async () => {
      const messenger = createDraftMessenger();
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      mockExecAgent.mockRejectedValueOnce(new Error('boom'));
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });

    it('posts a fallback when generic local-mode startup error draft delivery fails', async () => {
      const messenger = createDraftMessenger({
        createMessage: vi.fn().mockRejectedValue(new Error('Telegram unavailable')),
      });
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      mockExecAgent.mockRejectedValueOnce(new Error('boom'));
      const client = createClient();
      client.getMessenger.mockReturnValue(messenger);
      const thread = createThread();
      thread.isDM = true;
      const service = new AgentBridgeService(FAKE_DB, USER_ID);

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(messenger.createMessage).toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledWith({ markdown: expect.any(String) });
      expect(messenger.clearDraft).not.toHaveBeenCalled();
    });

    it('swallows native draft cleanup failures after a successful reply', async () => {
      const messenger = createDraftMessenger({
        clearDraft: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      });
      await runWithHooks(messenger, async (hooks) => {
        const completion = hooks.find((hook: { id: string }) => hook.id === 'bot-completion');
        await completion.handler({
          lastAssistantContent: 'Final answer',
          reason: 'completed',
        });
      });

      expect(messenger.createMessage).toHaveBeenCalledWith(expect.stringContaining('Final answer'));
      expect(messenger.clearDraft).toHaveBeenCalledWith('draft-42');
    });
  });

  it('routes local attachment replies through the platform messenger', async () => {
    mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
    const messenger = createDraftMessenger({ createDraft: undefined });
    const client = createClient();
    client.getMessenger.mockReturnValue(messenger);
    mockExecAgent.mockImplementationOnce(async (params: any) => {
      queueMicrotask(() => {
        const completion = params.hooks.find(
          (hook: { id: string }) => hook.id === 'bot-completion',
        );
        void completion.handler({
          attachments: [
            {
              data: 'cmVwb3J0',
              mimeType: 'application/pdf',
              name: 'report.pdf',
              type: 'file',
            },
          ],
          lastAssistantContent: 'Report attached.',
          reason: 'completed',
        });
      });
      return localExecResult();
    });
    const thread = createThread();
    thread.isDM = false;
    const service = new AgentBridgeService(FAKE_DB, USER_ID);

    await service.handleMention(thread, createMessage(), {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(messenger.createMessage).toHaveBeenCalledWith({
      attachments: [
        {
          data: 'cmVwb3J0',
          mimeType: 'application/pdf',
          name: 'report.pdf',
          type: 'file',
        },
      ],
      content: expect.stringContaining('Report attached.'),
    });
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  describe('stale cached topic recovery', () => {
    // Regression tests for the Discord DM "Agent Execution Failed" with no
    // operation id: the thread state kept a topicId whose row was gone
    // (agent deleted → topics cascade-deleted, or out of scope after a
    // scope switch) or belonged to a previously-active agent. The old guard
    // only reset topics that still existed and were 4h+ stale, so execution
    // reached the topic-start reservation and died with "Topic not found"
    // before any operation was created.

    it('resets the cached topicId and starts a new topic when the topic no longer exists', async () => {
      mockTopicFindById.mockResolvedValue(undefined);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-deleted' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(thread.setState).toHaveBeenCalledWith(expect.objectContaining({ topicId: undefined }));
      // Fresh-mention path: execAgent must NOT receive the dead topicId.
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
      expect(mockExecAgent.mock.calls[0][0].appContext?.topicId).toBeUndefined();
    });

    it('resets the cached topicId when the topic belongs to a different agent', async () => {
      mockTopicFindById.mockResolvedValue({
        agentId: 'agent-previous',
        id: 'topic-1',
        updatedAt: new Date(),
      });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(thread.setState).toHaveBeenCalledWith(expect.objectContaining({ topicId: undefined }));
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
      expect(mockExecAgent.mock.calls[0][0].appContext?.topicId).toBeUndefined();
    });

    it('continues the cached topic when it exists, matches the agent, and is fresh', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(mockExecAgent).toHaveBeenCalledTimes(1);
      expect(mockExecAgent.mock.calls[0][0].appContext?.topicId).toBe('topic-1');
    });

    it('retries as a fresh mention when queue-mode execAgent reports Topic not found (delete race)', async () => {
      // Pre-flight sees the topic, but it vanishes before the topic-start
      // reservation — execAgent throws a plain "Topic not found" error.
      mockExecAgent
        .mockRejectedValueOnce(new Error('Topic not found: topic-1'))
        .mockResolvedValueOnce({
          assistantMessageId: 'assistant-msg-1',
          createdAt: new Date().toISOString(),
          operationId: 'op-2',
          topicId: 'topic-2',
        });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(thread.setState).toHaveBeenCalledWith(expect.objectContaining({ topicId: undefined }));
      expect(mockExecAgent).toHaveBeenCalledTimes(2);
      expect(mockExecAgent.mock.calls[1][0].appContext?.topicId).toBeUndefined();
      // The retry replaces the error reply — no "Agent Execution Failed" post.
      const postedBodies = (thread.post as any).mock.calls.map((c: any[]) => c[0]?.markdown ?? '');
      expect(postedBodies.join('\n')).not.toContain('Agent Execution Failed');
    });

    it('clears the abandoned native draft before retrying a stale topic in queue mode', async () => {
      const clearDraft = vi.fn().mockResolvedValue(undefined);
      const createDraft = vi
        .fn()
        .mockResolvedValueOnce('draft-old')
        .mockResolvedValueOnce('draft-new');
      const client = createClient();
      client.getMessenger.mockReturnValue({ clearDraft, createDraft, triggerTyping: vi.fn() });
      mockExecAgent
        .mockRejectedValueOnce(new Error('Topic not found: topic-1'))
        .mockResolvedValueOnce({
          assistantMessageId: 'assistant-msg-1',
          createdAt: new Date().toISOString(),
          operationId: 'op-2',
          success: true,
          topicId: 'topic-2',
        });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      thread.isDM = true;

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(createDraft).toHaveBeenCalledTimes(2);
      expect(clearDraft).toHaveBeenCalledWith('draft-old');
    });

    it('retries as a fresh mention on Topic not found in local (non-queue) mode too', async () => {
      // Same delete race as above, but with the queue runtime disabled the
      // error surfaces in executeWithCallback's local-mode catch — which used
      // to swallow anything but the FK-violation form as a startup failure,
      // leaving the dead topicId in thread state with no retry.
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      // Second call: abort so the local-mode promise resolves instead of
      // waiting for a completion webhook that never comes in tests.
      const abortError = new Error('Agent execution aborted');
      abortError.name = 'AbortError';
      mockExecAgent
        .mockRejectedValueOnce(new Error('Topic not found: topic-1'))
        .mockRejectedValueOnce(abortError);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(thread.setState).toHaveBeenCalledWith(expect.objectContaining({ topicId: undefined }));
      // The rethrow must reach handleSubscribedMessage and trigger the
      // fresh-mention retry (second execAgent call without the dead topicId).
      expect(mockExecAgent).toHaveBeenCalledTimes(2);
      expect(mockExecAgent.mock.calls[1][0].appContext?.topicId).toBeUndefined();
    });

    it('clears the abandoned native draft before retrying a stale topic in local mode', async () => {
      mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
      const clearDraft = vi.fn().mockResolvedValue(undefined);
      const createDraft = vi
        .fn()
        .mockResolvedValueOnce('draft-old')
        .mockResolvedValueOnce('draft-new');
      const client = createClient();
      client.getMessenger.mockReturnValue({ clearDraft, createDraft, triggerTyping: vi.fn() });
      const abortError = new Error('Agent execution aborted');
      abortError.name = 'AbortError';
      mockExecAgent
        .mockRejectedValueOnce(new Error('Topic not found: topic-1'))
        .mockRejectedValueOnce(abortError);
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      thread.isDM = true;

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(createDraft).toHaveBeenCalledTimes(2);
      expect(clearDraft).toHaveBeenCalledWith('draft-old');
    });
  });

  describe('progress message gating by supportsMessageEdit', () => {
    // Regression test for the QQ duplicate-reply bug:
    // QQ doesn't support message edits — the chat-adapter falls `editMessage`
    // back to `postMessage`. So if we posted an "ack" placeholder and then
    // tried to edit it on afterStep + onComplete, the user saw the placeholder
    // PLUS two duplicate copies of the final reply. Edit-incapable platforms
    // must skip the placeholder entirely so the final reply lands once.

    beforeEach(() => {
      // Happy-path startup so we only count the placeholder post, not error fallbacks.
      mockExecAgent.mockResolvedValue({
        assistantMessageId: 'assistant-msg-1',
        createdAt: new Date().toISOString(),
        operationId: 'op-1',
        success: true,
        topicId: 'topic-1',
      });
    });

    /** Pull the `progressMessageId` the bridge handed to execAgent's webhook hooks. */
    const progressMessageIdFromHooks = (): unknown => {
      const call = mockExecAgent.mock.calls.at(-1);
      const hooks = call?.[0]?.hooks as
        Array<{ id?: string; webhook?: { body?: Record<string, unknown> } }> | undefined;
      return hooks?.find((h) => h.id === 'bot-completion')?.webhook?.body?.progressMessageId;
    };

    it('posts the ack for an edit-incapable platform but does not track it as progressMessage', async () => {
      mockGetPlatform.mockReturnValue({
        id: 'qq',
        name: 'QQ',
        supportsMessageEdit: false,
      });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      const message = createMessage();
      const client = createClient();

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platform: 'qq', platformThreadId: 'qq:c2c:user-1' } as any,
        client,
      });

      // User still gets immediate feedback ("处理中…").
      expect(thread.post).toHaveBeenCalledTimes(1);
      // But the ack is NOT tracked as `progressMessage`, so the downstream
      // hooks won't try to edit it (which would surface as a duplicate message
      // on edit-incapable platforms).
      expect(progressMessageIdFromHooks()).toBeUndefined();
    });

    it('posts the ack AND tracks it as progressMessage when the platform supports edit', async () => {
      // Default mock returns supportsMessageEdit: true (Discord).
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();
      const message = createMessage();
      const client = createClient();

      await service.handleMention(thread, message, {
        agentId: 'agent-1',
        botContext: { platform: 'discord', platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(thread.post).toHaveBeenCalledTimes(1);
      // Tracked → downstream hooks will edit this message in place.
      expect(progressMessageIdFromHooks()).toBe('progress-msg-1');
    });
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
});
