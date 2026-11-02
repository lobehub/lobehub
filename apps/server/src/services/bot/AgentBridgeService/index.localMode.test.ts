import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderThrownAgentError } from '../renderThrownError';
import {
  renderAgentError,
  renderFinalReply,
  renderStepProgress,
  renderStopped,
} from '../replyTemplate';

/**
 * Local (in-process) execution mode: `execAgent` runs the registered hook
 * handlers itself, so these tests drive the `afterStep` / `onComplete`
 * handlers and the startup `.then` / `.catch` branches through the public
 * `handleMention` entry.
 */

const mockExecAgent = vi.hoisted(() => vi.fn());
const mockInterruptTask = vi.hoisted(() => vi.fn());
const mockGetPlatform = vi.hoisted(() => vi.fn());
const mockTopicFindById = vi.hoisted(() => vi.fn());
const mockTopicUpdate = vi.hoisted(() => vi.fn());
const mockGenerateTopicTitle = vi.hoisted(() => vi.fn());

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
      isRunningOperationAlive: vi.fn().mockResolvedValue(false),
      update: mockTopicUpdate,
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
    return { execAgent: mockExecAgent, interruptTask: mockInterruptTask };
  }),
}));

vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({ isConfigured: false, isEnabled: false }),
}));

vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: () => false,
}));

vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(function () {
    return { generateTopicTitle: mockGenerateTopicTitle };
  }),
}));

vi.mock('@/server/services/bot/formatPrompt', () => ({
  buildBotSender: vi.fn(),
  formatPrompt: vi.fn().mockReturnValue('formatted prompt'),
}));

vi.mock('@/server/services/bot/platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, platformRegistry: { getPlatform: mockGetPlatform } };
});

const { AgentBridgeService } = await import('./index');

const FAKE_DB = {} as any;
const USER_ID = 'user-123';
const THREAD_ID = 'discord:guild-1:channel-1:thread-1';
const MESSAGE_ID = 'msg-123';

const okResult = (extra?: Record<string, unknown>) => ({
  assistantMessageId: 'assistant-msg-1',
  createdAt: new Date().toISOString(),
  operationId: 'op-1',
  success: true,
  topicId: 'topic-1',
  ...extra,
});

const createThread = () => {
  const edit = vi.fn();
  const progress: { edit: typeof edit; id: string } = { edit, id: 'progress-msg-1' };
  edit.mockImplementation(async () => progress);
  const thread = {
    adapter: { decodeThreadId: vi.fn().mockReturnValue({}), fetchThread: vi.fn() },
    id: THREAD_ID,
    post: vi.fn().mockResolvedValue(progress),
    setState: vi.fn().mockResolvedValue(undefined),
    startTyping: vi.fn().mockResolvedValue(undefined),
    state: Promise.resolve(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { edit, thread };
};

const createMessage = () =>
  ({ author: { userName: 'tester' }, id: MESSAGE_ID, text: 'hello world' }) as any;

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

type HookEvent = Record<string, any>;

/** Make `execAgent` fire the given hook events before it resolves. */
const runHooks = (
  events: { afterStep?: HookEvent[]; onComplete?: HookEvent },
  result: Record<string, unknown> = okResult(),
) => {
  mockExecAgent.mockImplementation(async (params: any) => {
    const hook = (id: string) => params.hooks.find((h: any) => h.id === id);
    // Hooks fire after execAgent has returned the operation, as in production.
    setTimeout(async () => {
      for (const event of events.afterStep ?? []) await hook('bot-step-progress').handler(event);
      if (events.onComplete) await hook('bot-completion').handler(events.onComplete);
    }, 0);
    return result;
  });
};

const mention = async (
  thread: any,
  overrides: Record<string, unknown> = {},
  client = createClient().client,
) => {
  const service = new AgentBridgeService(FAKE_DB, USER_ID);
  await service.handleMention(thread, createMessage(), {
    agentId: 'agent-1',
    botContext: { platformThreadId: THREAD_ID } as any,
    client,
    replyLocale: 'en-US',
    ...overrides,
  });
};

describe('AgentBridgeService local mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatform.mockReturnValue({ id: 'discord', supportsMessageEdit: true });
    mockTopicFindById.mockResolvedValue({ id: 'topic-1', title: 'Existing' });
    mockInterruptTask.mockResolvedValue({ success: true });
    // The tracked operation map is process-wide; isolate each case.
    AgentBridgeService.clearActiveThread(THREAD_ID);
  });

  it('edits the progress message with the final reply and returns the topic', async () => {
    runHooks({ onComplete: { lastAssistantContent: 'final answer', reason: 'done' } });
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toEqual({ markdown: renderFinalReply('final answer') });
    expect(thread.setState).toHaveBeenCalledWith({ channelContext: undefined, topicId: 'topic-1' });
  });

  it('splits a long reply: first chunk edits the placeholder, the rest are posted', async () => {
    runHooks({ onComplete: { lastAssistantContent: 'a'.repeat(30), reason: 'done' } });
    const { edit, thread } = createThread();

    await mention(thread, { charLimit: 10 });

    expect(edit).toHaveBeenCalledTimes(1);
    // 1 placeholder post + the remaining chunks
    expect(thread.post.mock.calls.length).toBeGreaterThan(1);
    const posted = thread.post.mock.calls.slice(1).map((c: any[]) => c[0]);
    for (const body of posted) expect(Object.keys(body)).toEqual(['markdown']);
  });

  it('attaches hook attachments to the last chunk only', async () => {
    runHooks({
      onComplete: {
        attachments: [
          {
            fetchUrl: 'https://example.com/a.png',
            mimeType: 'image/png',
            name: 'a',
            type: 'image',
          },
          { data: Buffer.from('hi').toString('base64'), name: 'b', type: 'file' },
          { name: 'skipped', type: 'file' },
        ],
        reason: 'done',
      },
    });
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledWith({
      attachments: [
        { mimeType: 'image/png', name: 'a', type: 'image', url: 'https://example.com/a.png' },
        { data: Buffer.from('hi'), mimeType: undefined, name: 'b', type: 'file' },
      ],
      markdown: '',
    });
  });

  it('posts the reply fresh when the platform cannot edit messages', async () => {
    mockGetPlatform.mockReturnValue({ id: 'qq', supportsMessageEdit: false });
    runHooks({ onComplete: { lastAssistantContent: 'final answer', reason: 'done' } });
    const { edit, thread } = createThread();

    await mention(thread, { botContext: { platform: 'qq', platformThreadId: THREAD_ID } });

    expect(edit).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenLastCalledWith({ markdown: renderFinalReply('final answer') });
  });

  it('renders the curated agent error on reason=error without a generic duplicate', async () => {
    runHooks({
      onComplete: {
        errorMessage: 'boom',
        errorType: 'ProviderBizError',
        operationId: 'op-1',
        reason: 'error',
      },
    });
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toEqual({
      markdown: renderAgentError('ProviderBizError', 'boom', 'op-1', 'en-US'),
    });
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  it('renders the stopped notice on reason=interrupted', async () => {
    runHooks({ onComplete: { reason: 'interrupted' } });
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledWith({ markdown: renderStopped(undefined, 'en-US') });
  });

  it('reports an empty completion as a thrown error', async () => {
    runHooks({ onComplete: { reason: 'done' } });
    const { thread } = createThread();

    await mention(thread);

    expect(thread.post).toHaveBeenLastCalledWith({
      markdown: renderThrownAgentError(
        new Error('Agent completed but no response content found'),
        'op-1',
        'en-US',
      ),
    });
  });

  it('streams step progress when displayToolCalls is on and skips identical edits', async () => {
    const step = {
      content: 'thinking...',
      elapsedMs: 10,
      shouldContinue: true,
      stepType: 'call_llm',
      totalSteps: 1,
    };
    runHooks({ afterStep: [step, step], onComplete: { reason: 'interrupted' } });
    const { edit, thread } = createThread();
    const { client, replaceReaction } = createClient();

    await mention(thread, { displayToolCalls: true, reactionMode: 'full' }, client);

    // one step edit (the identical second frame is skipped) + the stopped notice
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[1][0]).toEqual({ markdown: renderStopped(undefined, 'en-US') });
    expect(edit.mock.calls[0][0].markdown).toBe(
      renderStepProgress(
        {
          content: 'thinking...',
          elapsedMs: 10,
          executionTimeMs: 0,
          lastContent: undefined,
          lastToolsCalling: undefined,
          reasoning: undefined,
          stepType: 'call_llm',
          thinking: false,
          toolsCalling: undefined,
          toolsResult: undefined,
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalSteps: 1,
          totalTokens: 0,
          totalToolCalls: 0,
        },
        'en-US',
      ),
    );
    // received → thinking, the step stays on thinking, then cleared in finally
    expect(replaceReaction.mock.calls).toEqual([
      [MESSAGE_ID, null, '👀'],
      [MESSAGE_ID, '👀', '🤔'],
      [MESSAGE_ID, '🤔', null],
    ]);
  });

  it('does not stream step progress when displayToolCalls is off', async () => {
    runHooks({
      afterStep: [{ content: 'x', shouldContinue: true, stepType: 'call_llm' }],
      onComplete: { lastAssistantContent: 'done', reason: 'done' },
    });
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith({ markdown: renderFinalReply('done') });
  });

  it('edits the startup error when execAgent fails without a terminal report', async () => {
    mockExecAgent.mockResolvedValue(okResult({ error: 'DEVICE_NOT_FOUND', success: false }));
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledWith({
      markdown: renderThrownAgentError('DEVICE_NOT_FOUND', 'op-1', 'en-US'),
    });
  });

  it('renders the stopped notice when startup is aborted', async () => {
    const abortError = new Error('Execution stopped before startup.');
    abortError.name = 'AbortError';
    mockExecAgent.mockRejectedValue(abortError);
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledWith({
      markdown: renderStopped('Execution stopped before startup.', 'en-US'),
    });
  });

  it('edits a generic startup rejection into the progress message', async () => {
    const error = new Error('network down');
    mockExecAgent.mockRejectedValue(error);
    const { edit, thread } = createThread();

    await mention(thread);

    expect(edit).toHaveBeenCalledWith({
      markdown: renderThrownAgentError(error, undefined, 'en-US'),
    });
  });

  it('interrupts the operation once known when /stop arrived during startup', async () => {
    mockExecAgent.mockImplementation(async () => {
      AgentBridgeService.requestStop(THREAD_ID);
      return okResult();
    });
    const { thread } = createThread();

    // The local promise only settles via a hook; complete it after interrupt.
    const service = new AgentBridgeService(FAKE_DB, USER_ID);
    const pending = service.handleMention(thread, createMessage(), {
      agentId: 'agent-1',
      botContext: { platformThreadId: THREAD_ID } as any,
      client: createClient().client,
    });
    await vi.waitFor(() => expect(mockInterruptTask).toHaveBeenCalledWith({ operationId: 'op-1' }));
    expect(AgentBridgeService.getActiveOperationId(THREAD_ID)).toBeUndefined();

    const hooks = mockExecAgent.mock.calls[0][0].hooks;
    await hooks.find((h: any) => h.id === 'bot-completion').handler({ reason: 'interrupted' });
    await pending;
  });

  it('generates a topic title after a text reply when the topic has none', async () => {
    mockTopicFindById.mockResolvedValue({ id: 'topic-1', title: null });
    mockGenerateTopicTitle.mockResolvedValue('New title');
    runHooks({ onComplete: { lastAssistantContent: 'final answer', reason: 'done' } });
    const { thread } = createThread();

    await mention(thread);

    await vi.waitFor(() =>
      expect(mockTopicUpdate).toHaveBeenCalledWith('topic-1', { title: 'New title' }),
    );
    expect(mockGenerateTopicTitle).toHaveBeenCalledWith({
      lastAssistantContent: 'final answer',
      topicId: 'topic-1',
      userPrompt: 'formatted prompt',
    });
  });
});
