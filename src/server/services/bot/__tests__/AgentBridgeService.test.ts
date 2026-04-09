import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUserSettings = vi.hoisted(() => vi.fn());
const mockExecAgent = vi.hoisted(() => vi.fn());
const mockFormatPrompt = vi.hoisted(() => vi.fn());
const mockGetPlatform = vi.hoisted(() => vi.fn());
const mockIsQueueAgentRuntimeEnabled = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
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

function mockLocalExecAgentWithFinalReply(reply: string) {
  mockExecAgent.mockImplementationOnce(async (input: Record<string, any>) => {
    await input.stepCallbacks.onComplete({
      finalState: {
        cost: { total: 0 },
        messages: [{ content: reply, role: 'assistant' }],
        usage: { llm: { apiCalls: 1, tokens: { total: 10 } }, tools: { totalCalls: 0 } },
      },
      reason: 'completed',
    });

    return {
      assistantMessageId: 'assistant-msg-1',
      createdAt: new Date().toISOString(),
      operationId: 'op-1',
      success: true,
      topicId: 'topic-1',
    };
  });
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

  it('cleans up received reaction when queue-mode mention setup fails before callback handoff', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    const message = createMessage();
    const client = createClient();

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    const [mentionReactionThreadId, mentionReactionMessageId, mentionReactionEmoji] =
      thread.adapter.removeReaction.mock.calls[0];
    expect(mentionReactionThreadId).toBe(THREAD_ID);
    expect(mentionReactionMessageId).toBe(MESSAGE_ID);
    expect(mentionReactionEmoji).toBeDefined();
    expect(mockExecAgent).not.toHaveBeenCalled();
  });

  it('cleans up received reaction when queue-mode subscribed-message setup fails before callback handoff', async () => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread({ topicId: 'topic-1' });
    const message = createMessage();
    const client = createClient();

    await service.handleSubscribedMessage(thread, message, {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client,
    });

    const [replyReactionThreadId, replyReactionMessageId, replyReactionEmoji] =
      thread.adapter.removeReaction.mock.calls[0];
    expect(replyReactionThreadId).toBe(THREAD_ID);
    expect(replyReactionMessageId).toBe(MESSAGE_ID);
    expect(replyReactionEmoji).toBeDefined();
    expect(mockExecAgent).not.toHaveBeenCalled();
  });

  it('skips editable placeholder for non-editable platforms in local mode', async () => {
    mockIsQueueAgentRuntimeEnabled.mockReturnValue(false);
    mockGetPlatform.mockReturnValue({ id: 'dingtalk', supportsMessageEdit: false });
    mockLocalExecAgentWithFinalReply('hello back');

    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = createThread();
    const message = createMessage();
    const client = createClient();
    const messenger = {
      createMessage: vi.fn().mockResolvedValue({ id: 'm1' }),
      editMessage: vi.fn(),
      removeReaction: vi.fn(),
      triggerTyping: vi.fn(),
    };
    client.getMessenger.mockReturnValue(messenger);

    message.raw = {
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc123',
    };

    await service.handleMention(thread, message, {
      agentId: 'agent-1',
      botContext: { platform: 'dingtalk', platformThreadId: THREAD_ID } as any,
      client,
    });

    expect(thread.post).not.toHaveBeenCalled();
    expect(client.getMessenger).toHaveBeenCalledTimes(1);
    expect(messenger.createMessage).toHaveBeenCalledWith('hello back');
  });
});
