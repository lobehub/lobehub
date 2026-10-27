import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderFinalReply } from '../replyTemplate';
import { FAKE_DB, MESSAGE_ID, THREAD_ID, USER_ID } from './testUtils';

/**
 * Silence as a first-class result (`no_reply`) and the visible feedback a follow-up wake holds
 * back until the agent speaks, in both execution modes: queue (hooks land as webhooks) and local
 * (hooks run in-process). The @mention path is asserted unchanged alongside.
 */

const mockExecAgent = vi.hoisted(() => vi.fn());
const mockIsQueue = vi.hoisted(() => vi.fn());
const mockGetPlatform = vi.hoisted(() => vi.fn());
const mockTopicFindById = vi.hoisted(() => vi.fn());
const mockIsRunningOperationAlive = vi.hoisted(() => vi.fn());
const mockDeferBotMessages = vi.hoisted(() => vi.fn());
const mockRecordNoReplyLabel = vi.hoisted(() => vi.fn());

vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ replayDeferredMessages: vi.fn() }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: vi.fn() }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      findById: mockTopicFindById,
      isRunningOperationAlive: mockIsRunningOperationAlive,
      update: vi.fn(),
    };
  }),
}));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({ general: { timezone: 'UTC' } }) };
  }),
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: '', INTERNAL_APP_URL: '' } }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return { execAgent: mockExecAgent };
  }),
}));
vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isConfigured: false, isEnabled: false }),
}));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: mockIsQueue }));
vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(function () {
    return { generateTopicTitle: vi.fn() };
  }),
}));
vi.mock('@/server/services/bot/formatPrompt', () => ({
  buildBotSender: vi.fn(),
  formatPrompt: vi.fn().mockReturnValue('formatted prompt'),
}));
vi.mock('@/server/services/bot/deferredMessages', () => ({
  deferBotMessages: mockDeferBotMessages,
  isDeferredMessagesAvailable: () => true,
}));
vi.mock('@/server/services/bot/noReplyLabel', () => ({
  recordNoReplyLabel: mockRecordNoReplyLabel,
}));
vi.mock('@/server/services/bot/platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, platformRegistry: { getPlatform: mockGetPlatform } };
});

const { AgentBridgeService } = await import('./index');

const botContext = {
  applicationId: 'app-1',
  platform: 'discord',
  platformThreadId: THREAD_ID,
} as any;

const okResult = {
  assistantMessageId: 'assistant-msg-1',
  createdAt: new Date().toISOString(),
  operationId: 'op-1',
  success: true,
  topicId: 'topic-1',
};

const createThread = () => {
  const progress = {
    delete: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn(),
    id: 'progress-msg-1',
  };
  progress.edit.mockResolvedValue(progress);
  const thread = {
    id: THREAD_ID,
    post: vi.fn().mockResolvedValue(progress),
    setState: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    state: Promise.resolve({ topicId: 'topic-1' }),
    subscribe: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { progress, thread };
};

const createClient = () => {
  const replaceReaction = vi.fn().mockResolvedValue(undefined);
  const client = {
    extractChatId: vi.fn(),
    getMessenger: vi.fn().mockReturnValue({ replaceReaction, triggerTyping: vi.fn() }),
    id: 'discord',
    shouldSubscribe: vi.fn().mockReturnValue(true),
  } as any;
  return { client, replaceReaction };
};

const message = () =>
  ({ author: { userName: 'tester' }, id: MESSAGE_ID, text: 'we have a bug' }) as any;

type HookEvent = Record<string, any>;

/** Make `execAgent` fire the in-process hook handlers once it has returned (local mode). */
const runHooks = (events: { afterStep?: HookEvent[]; onComplete?: HookEvent }) => {
  mockExecAgent.mockImplementation(async (params: any) => {
    const hook = (id: string) => params.hooks.find((h: any) => h.id === id);
    setTimeout(async () => {
      for (const event of events.afterStep ?? []) await hook('bot-step-progress').handler(event);
      if (events.onComplete) await hook('bot-completion').handler(events.onComplete);
    }, 0);
    return okResult;
  });
};

const subscribed = async (
  thread: any,
  client: any,
  extra: Record<string, unknown> = {},
  userMessage = message(),
) =>
  new AgentBridgeService(FAKE_DB, USER_ID).handleSubscribedMessage(thread, userMessage, {
    agentId: 'agent-1',
    botContext,
    client,
    replyLocale: 'en-US',
    ...extra,
  });

/** A wake that opens a new topic: a channel wake, or a subscribed thread whose topic is gone. */
const fresh = async (thread: any, client: any, extra: Record<string, unknown> = {}) =>
  new AgentBridgeService(FAKE_DB, USER_ID).handleMention(thread, message(), {
    agentId: 'agent-1',
    botContext,
    client,
    replyLocale: 'en-US',
    ...extra,
  });

const execParams = () => mockExecAgent.mock.calls[0][0];
const posted = (thread: any) => thread.post.mock.calls.map((c: any[]) => c[0]);

describe('AgentBridgeService no_reply and deferred follow-up feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatform.mockReturnValue({ id: 'discord', name: 'Discord', supportsMessageEdit: true });
    mockTopicFindById.mockResolvedValue({
      agentId: 'agent-1',
      id: 'topic-1',
      updatedAt: new Date(),
    });
    mockIsRunningOperationAlive.mockResolvedValue(false);
    mockDeferBotMessages.mockResolvedValue(true);
    mockRecordNoReplyLabel.mockResolvedValue('false_wake');
    AgentBridgeService.clearActiveThread(THREAD_ID);
  });

  describe('local mode', () => {
    beforeEach(() => mockIsQueue.mockReturnValue(false));

    it('followup + NO_REPLY: leaves no visible trace and labels the wake with the reason', async () => {
      runHooks({
        onComplete: {
          lastAssistantContent: 'NO_REPLY:off_topic',
          operationId: 'op-1',
          reason: 'done',
        },
      });
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(replaceReaction).not.toHaveBeenCalled();
      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({
          applicationId: 'app-1',
          noReply: { reason: 'off_topic' },
          operationId: 'op-1',
          platform: 'discord',
          platformThreadId: THREAD_ID,
          userId: USER_ID,
          userMessageId: MESSAGE_ID,
        }),
      );
    });

    it('followup + an empty completion is silence (empty_completion), not a fault', async () => {
      runHooks({ onComplete: { lastAssistantContent: '', operationId: 'op-1', reason: 'done' } });
      const { thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(thread.post).not.toHaveBeenCalled();
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ noReply: { reason: 'empty_completion' } }),
      );
    });

    it('followup that answers straight away posts the reply as a new message, with no placeholder', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'here is the fix', reason: 'done' } });
      const { progress, thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(posted(thread)).toEqual([{ markdown: renderFinalReply('here is the fix') }]);
      expect(progress.edit).not.toHaveBeenCalled();
      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(replaceReaction).not.toHaveBeenCalled();
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });

    it('followup shows typing, the thinking reaction and the placeholder once the agent acts', async () => {
      runHooks({
        afterStep: [{ shouldContinue: true, stepType: 'call_tool', toolsCalling: [{}] }],
        onComplete: { lastAssistantContent: 'done it', reason: 'done' },
      });
      const { progress, thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(thread.startTyping).toHaveBeenCalledTimes(1);
      expect(replaceReaction).toHaveBeenCalledWith(MESSAGE_ID, null, '🤔');
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(progress.edit).toHaveBeenLastCalledWith({ markdown: renderFinalReply('done it') });
      expect(progress.delete).not.toHaveBeenCalled();
    });

    it('followup that acted and then chose silence removes the placeholder it showed', async () => {
      runHooks({
        afterStep: [{ shouldContinue: true, stepType: 'call_tool', toolsCalling: [{}] }],
        onComplete: {
          lastAssistantContent: 'NO_REPLY:duplicate',
          operationId: 'op-1',
          reason: 'done',
        },
      });
      const { progress, thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(progress.delete).toHaveBeenCalledTimes(1);
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ noReply: { reason: 'duplicate' } }),
      );
    });

    it('followup error: the failure is still reported to the user', async () => {
      runHooks({
        onComplete: { errorMessage: 'boom', errorType: 'ProviderBizError', reason: 'error' },
      });
      const { thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(posted(thread)[0].markdown).toContain('Agent Execution Failed');
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });

    it('mention keeps immediate feedback and treats NO_REPLY as ordinary text', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'NO_REPLY', reason: 'done' } });
      const { progress, thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client);

      // Once from the bridge and once from `executeWithCallback`, as before this change.
      expect(thread.startTyping).toHaveBeenCalledTimes(2);
      expect(replaceReaction).toHaveBeenCalledWith(MESSAGE_ID, null, '👀');
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(progress.edit).toHaveBeenLastCalledWith({ markdown: renderFinalReply('NO_REPLY') });
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
      expect(execParams().botPlatformContext?.wakeKind).toBeUndefined();
    });

    it('mention with an empty completion is still a failure, not silence', async () => {
      runHooks({ onComplete: { lastAssistantContent: '', reason: 'done' } });
      const { thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client);

      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
      expect(posted(thread).at(-1).markdown).toContain('no response content');
    });

    it('followup that opens a new topic still holds feedback back and may end in silence', async () => {
      runHooks({
        onComplete: { lastAssistantContent: 'NO_REPLY', operationId: 'op-1', reason: 'done' },
      });
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await fresh(thread, client, { wakeKind: 'followup' });

      expect(replaceReaction).not.toHaveBeenCalled();
      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(execParams().botPlatformContext.wakeKind).toBe('followup');
      expect(mockRecordNoReplyLabel).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ noReply: { reason: 'unspecified' } }),
      );
    });

    it('tells the agent the acknowledgement already posted before the run', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'found it', reason: 'done' } });
      const { thread } = createThread();
      const { client } = createClient();

      await fresh(thread, client, { openingReply: "Got it, I'll check the logs first." });

      expect(execParams().botPlatformContext.openingReply).toBe(
        "Got it, I'll check the logs first.",
      );
    });

    it('tells a followup agent it may stay silent', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'NO_REPLY', reason: 'done' } });
      const { thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(execParams().botPlatformContext.wakeKind).toBe('followup');
    });

    it('tells a followup agent woken by its duties which duty, and only a followup', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'NO_REPLY', reason: 'done' } });
      const { client } = createClient();
      const duty = { matched: '评估需求' };

      await subscribed(createThread().thread, client, { duty, wakeKind: 'followup' });
      expect(execParams().botPlatformContext.duty).toEqual(duty);

      mockExecAgent.mockClear();
      AgentBridgeService.clearActiveThread(THREAD_ID);
      await subscribed(createThread().thread, client, { duty });
      expect(execParams().botPlatformContext.duty).toBeUndefined();
    });

    it('tells a followup agent woken by its name why, and only a followup', async () => {
      runHooks({ onComplete: { lastAssistantContent: 'NO_REPLY', reason: 'done' } });
      const { client } = createClient();

      await subscribed(createThread().thread, client, { named: true, wakeKind: 'followup' });
      expect(execParams().botPlatformContext.named).toBe(true);

      mockExecAgent.mockClear();
      AgentBridgeService.clearActiveThread(THREAD_ID);
      await subscribed(createThread().thread, client, { named: true });
      expect(execParams().botPlatformContext.named).toBeUndefined();
    });

    it('a catch-all wake the bot started itself shows nothing until the agent acts', async () => {
      runHooks({
        onComplete: { lastAssistantContent: 'NO_REPLY', operationId: 'op-1', reason: 'done' },
      });
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await new AgentBridgeService(FAKE_DB, USER_ID).handleMention(thread, message(), {
        agentId: 'agent-1',
        botContext,
        client,
        replyLocale: 'en-US',
        wakeKind: 'followup',
      });

      expect(replaceReaction).not.toHaveBeenCalled();
      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(execParams().botPlatformContext.wakeKind).toBe('followup');
    });
  });

  describe('queue mode', () => {
    beforeEach(() => {
      mockIsQueue.mockReturnValue(true);
      mockExecAgent.mockResolvedValue(okResult);
    });

    const hook = (id: string) => execParams().hooks.find((h: any) => h.id === id);

    it('followup: hands off without any visible feedback and forwards wakeKind to both webhooks', async () => {
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(replaceReaction).not.toHaveBeenCalled();
      expect(hook('bot-step-progress').webhook.body).toMatchObject({
        progressMessageId: undefined,
        type: 'step',
        wakeKind: 'followup',
      });
      expect(hook('bot-completion').webhook.body).toMatchObject({
        type: 'completion',
        userMessageId: MESSAGE_ID,
        wakeKind: 'followup',
      });
      expect(execParams().botPlatformContext.wakeKind).toBe('followup');
    });

    it('mention: keeps the immediate reaction, typing and placeholder, and forwards wakeKind=mention', async () => {
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client);

      expect(thread.startTyping).toHaveBeenCalledTimes(2);
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(replaceReaction).toHaveBeenCalledWith(MESSAGE_ID, null, '👀');
      expect(hook('bot-completion').webhook.body).toMatchObject({
        progressMessageId: 'progress-msg-1',
        wakeKind: 'mention',
      });
      expect(execParams().botPlatformContext.wakeKind).toBeUndefined();
    });

    it('followup: a startup failure is still reported to the user', async () => {
      mockExecAgent.mockRejectedValue(new Error('exec exploded'));
      const { thread } = createThread();
      const { client } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(mockRecordNoReplyLabel).not.toHaveBeenCalled();
    });

    it('followup arriving while the topic is still running is parked for replay, with no feedback', async () => {
      mockTopicFindById.mockResolvedValue({
        agentId: 'agent-1',
        id: 'topic-1',
        metadata: { runningOperation: { assistantMessageId: 'a-1', operationId: 'op-running' } },
        updatedAt: new Date(),
      });
      mockIsRunningOperationAlive.mockResolvedValue(true);
      const { thread } = createThread();
      const { client, replaceReaction } = createClient();

      await subscribed(thread, client, { wakeKind: 'followup' });

      expect(mockDeferBotMessages).toHaveBeenCalledTimes(1);
      expect(mockExecAgent).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
      expect(thread.startTyping).not.toHaveBeenCalled();
      expect(replaceReaction).not.toHaveBeenCalled();
    });
  });
});
