import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient, createMessage, createThread, FAKE_DB, USER_ID } from './testUtils';

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

/**
 * DingTalk conversations through the shared bridge: a single chat or a group
 * @-mention starts a topic, the topic id is kept in the chat SDK thread state,
 * and the next message in the same conversation continues that topic. The
 * completion hooks carry the DingTalk thread id, which is what the bot
 * callback uses to post the reply back into the same chat.
 */
const SINGLE_THREAD = 'dingtalk:single:manager1234';
const GROUP_THREAD = 'dingtalk:group:cidMockGroup==';

const dingtalkThread = (id: string, state?: Record<string, unknown>) => ({
  ...createThread(state),
  id,
  isDM: id.startsWith('dingtalk:single:'),
});

describe('AgentBridgeService with DingTalk conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAgent.mockResolvedValue({
      assistantMessageId: 'assistant-msg-1',
      createdAt: new Date().toISOString(),
      operationId: 'op-1',
      topicId: 'topic-dingtalk-1',
    });
    mockFormatPrompt.mockReturnValue('formatted prompt');
    mockGetPlatform.mockReturnValue({
      id: 'dingtalk',
      name: 'DingTalk',
      supportsMessageEdit: false,
    });
    mockGetUserSettings.mockResolvedValue({ general: { timezone: 'UTC' } });
    mockIsQueueAgentRuntimeEnabled.mockReturnValue(true);
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      id: 'topic-dingtalk-1',
      updatedAt: new Date(),
    });
    mockIsRunningOperationAlive.mockResolvedValue(false);
    mockIsDeferredMessagesAvailable.mockReturnValue(true);
    mockDeferBotMessages.mockResolvedValue(true);
  });

  it.each([
    ['single chat', SINGLE_THREAD],
    ['group @-mention', GROUP_THREAD],
  ])(
    'a %s starts a topic, stores it on the thread, and hooks the reply to that thread',
    async (_label, threadId) => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = dingtalkThread(threadId);

      await service.handleMention(thread as any, createMessage(), {
        agentId: 'agent-1',
        botContext: {
          applicationId: 'dingapp',
          platform: 'dingtalk',
          platformThreadId: threadId,
        } as any,
        client: createClient(),
      });

      expect(mockExecAgent).toHaveBeenCalledTimes(1);
      const params = mockExecAgent.mock.calls[0][0];
      // A first message has no topic yet — the run creates one.
      expect(params.appContext?.topicId).toBeUndefined();
      expect(params.hooks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'bot-completion',
            type: 'onComplete',
            webhook: expect.objectContaining({
              body: expect.objectContaining({ platformThreadId: threadId, type: 'completion' }),
            }),
          }),
        ]),
      );
      expect(thread.subscribe).toHaveBeenCalled();
      expect(thread.setState).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'topic-dingtalk-1' }),
      );
    },
  );

  it.each([
    ['single chat', SINGLE_THREAD],
    ['group', GROUP_THREAD],
  ])('a follow-up in the same %s continues the stored topic', async (_label, threadId) => {
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const thread = dingtalkThread(threadId, { topicId: 'topic-dingtalk-1' });

    await service.handleSubscribedMessage(thread as any, createMessage(), {
      agentId: 'agent-1',
      botContext: {
        applicationId: 'dingapp',
        platform: 'dingtalk',
        platformThreadId: threadId,
      } as any,
      client: createClient(),
    });

    expect(mockExecAgent).toHaveBeenCalledTimes(1);
    expect(mockExecAgent.mock.calls[0][0].appContext?.topicId).toBe('topic-dingtalk-1');
  });
});
