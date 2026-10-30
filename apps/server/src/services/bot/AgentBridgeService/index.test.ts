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
const { AiAgentService } = await import('@/server/services/aiAgent');

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

  describe('reactionMode', () => {
    function createReactionClient() {
      const replaceReaction = vi.fn().mockResolvedValue(undefined);
      const client = createClient();
      client.getMessenger = vi.fn().mockReturnValue({ replaceReaction, triggerTyping: vi.fn() });
      return { client, replaceReaction };
    }

    it('applies ACK then thinking by default (minimal) without a mode in opts', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const { client, replaceReaction } = createReactionClient();

      await service.handleMention(createThread(), createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(replaceReaction.mock.calls).toEqual([
        [MESSAGE_ID, null, '👀'],
        [MESSAGE_ID, '👀', '🤔'],
      ]);
    });

    it('applies the same two transitions under full mode', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const { client, replaceReaction } = createReactionClient();

      await service.handleMention(createThread(), createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
        reactionMode: 'full',
      });

      expect(replaceReaction.mock.calls).toEqual([
        [MESSAGE_ID, null, '👀'],
        [MESSAGE_ID, '👀', '🤔'],
      ]);
    });

    it('never touches reactions under none on the mention path', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const { client, replaceReaction } = createReactionClient();

      await service.handleMention(createThread(), createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
        reactionMode: 'none',
      });

      expect(replaceReaction).not.toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });

    it('never touches reactions under none on the subscribed-message path', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const { client, replaceReaction } = createReactionClient();

      await service.handleSubscribedMessage(createThread({ topicId: 'topic-1' }), createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
        reactionMode: 'none',
      });

      expect(replaceReaction).not.toHaveBeenCalled();
      expect(mockExecAgent).toHaveBeenCalledTimes(1);
    });
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

    it('resets the cached topicId when the topic has been idle past the threshold', async () => {
      mockTopicFindById.mockResolvedValue({
        agentId: 'agent-1',
        id: 'topic-1',
        updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client: createClient(),
      });

      expect(thread.setState).toHaveBeenCalledWith(expect.objectContaining({ topicId: undefined }));
      expect(mockExecAgent.mock.calls[0][0].appContext?.topicId).toBeUndefined();
    });

    it('continues an idle topic when the platform thread never expires (Discord guild thread)', async () => {
      // A reply in a Discord thread 8h after the last turn used to fork a
      // new topic with no working directory, losing the whole conversation.
      mockTopicFindById.mockResolvedValue({
        agentId: 'agent-1',
        id: 'topic-1',
        updatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread({ topicId: 'topic-1' });
      const client = { ...createClient(), shouldExpireIdleTopic: vi.fn().mockReturnValue(false) };

      await service.handleSubscribedMessage(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platformThreadId: THREAD_ID } as any,
        client,
      });

      expect(client.shouldExpireIdleTopic).toHaveBeenCalledWith(thread.id);
      expect(thread.setState).not.toHaveBeenCalledWith(
        expect.objectContaining({ topicId: undefined }),
      );
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

    it('skips the ack on an edit-incapable platform when processingMessage is off', async () => {
      mockGetPlatform.mockReturnValue({ id: 'qq', name: 'QQ', supportsMessageEdit: false });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platform: 'qq', platformThreadId: 'qq:c2c:user-1' } as any,
        botSettings: { processingMessage: false },
        client: createClient(),
      });

      expect(thread.post).not.toHaveBeenCalled();
      expect(thread.startTyping).toHaveBeenCalled();
      expect(progressMessageIdFromHooks()).toBeUndefined();
    });

    it('skips the ack and posts the reply fresh on an editable platform when processingMessage is off', async () => {
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platform: 'discord', platformThreadId: THREAD_ID } as any,
        botSettings: { processingMessage: false },
        client: createClient(),
      });

      expect(thread.post).not.toHaveBeenCalled();
      expect(progressMessageIdFromHooks()).toBeUndefined();
    });

    it('keeps the ack when processingMessage is on', async () => {
      mockGetPlatform.mockReturnValue({ id: 'qq', name: 'QQ', supportsMessageEdit: false });
      const service = new AgentBridgeService(FAKE_DB, USER_ID);
      const thread = createThread();

      await service.handleMention(thread, createMessage(), {
        agentId: 'agent-1',
        botContext: { platform: 'qq', platformThreadId: 'qq:c2c:user-1' } as any,
        botSettings: { processingMessage: true },
        client: createClient(),
      });

      expect(thread.post).toHaveBeenCalledTimes(1);
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
});
