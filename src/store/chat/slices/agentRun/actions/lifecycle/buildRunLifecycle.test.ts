import type { ConversationContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { messageMapKey } from '../../../../utils/messageMapKey';
import { topicMapKey } from '../../../../utils/topicMapKey';
import type { AgentRuntimeType } from '../dispatch/agentDispatcher';
import { buildRunLifecycle } from './buildRunLifecycle';
import type { RunCompleteEvent, RunTerminalStatus, UserMessagePersistedEvent } from './types';

const desktopNotificationMock = vi.hoisted(() => ({
  notifyDesktopAgentCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/chat/utils/desktopNotification', () => ({
  notifyDesktopAgentCompleted: desktopNotificationMock.notifyDesktopAgentCompleted,
}));

// Force the desktop branch of afterRunComplete on (isDesktop is false in the
// test env). Only afterRunComplete reads isDesktop, and it early-returns for
// sub_agent runs before the check, so this is inert for every other test.
vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, isDesktop: true };
});

const OP = 'op1';
const CONTEXT: ConversationContext = {
  agentId: 'a1',
  topicId: 't1',
  workspaceSlug: 'team',
} as ConversationContext;

const makeStore = () => {
  const store = {
    activeAgentId: 'a1',
    activeGroupId: undefined,
    activeTopicId: 't1',
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    drainQueuedMessages: vi.fn<ChatStore['drainQueuedMessages']>(() => []),
    queuedMessages: {} as Record<string, unknown[]>,
    failOperation: vi.fn(),
    internal_updateTopic: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {},
    operationsByContext: { [messageMapKey(CONTEXT)]: [OP] },
    operations: {
      [OP]: {
        id: OP,
        context: CONTEXT,
        metadata: {},
        status: 'running',
      },
    },
    refreshTopic: vi.fn(async () => {}),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
    // topicDataMap / messagesMap reads default to empty (no topic, no messages).
    topicDataMap: {},
    updateTopicStatus: vi.fn(async () => {}),
  };
  return { get: (() => store) as unknown as () => ChatStore, store };
};

const lifecycle = (
  runtimeType: AgentRuntimeType,
  get: () => ChatStore,
  runScope: 'sub_agent' | 'top_level' = 'top_level',
) =>
  buildRunLifecycle(get, {
    context: CONTEXT,
    parentMessageId: 'u1',
    parentMessageType: 'user',
    runId: OP,
    runScope,
    runtimeType,
  });

const completeEvent = (
  runtimeType: AgentRuntimeType,
  fields: Partial<RunCompleteEvent>,
): RunCompleteEvent => ({
  context: CONTEXT,
  operationId: OP,
  runId: OP,
  runScope: 'top_level',
  runtimeType,
  ...fields,
});

beforeEach(() => {
  desktopNotificationMock.notifyDesktopAgentCompleted.mockClear();
});

describe('buildRunLifecycle.completeRun — transport-driven disposition', () => {
  it('`status: completed` completes the op and marks the topic unread', async () => {
    const { get, store } = makeStore();
    await lifecycle('gateway', get).completeRun(completeEvent('gateway', { status: 'completed' }));

    expect(store.completeOperation).toHaveBeenCalledWith(OP);
    expect(store.markTopicUnread).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'a1', topicId: 't1' }),
    );
    expect(store.failOperation).not.toHaveBeenCalled();
  });

  it('summarizes an audio-first topic before returning a queued follow-up', async () => {
    const { get, store } = makeStore();
    const messages = [
      {
        audioList: [{ alt: 'voice.webm', id: 'audio-1', url: 'https://example.com/voice.webm' }],
        content: '',
        id: 'u1',
        role: 'user',
      },
      { content: 'The recording asks how to list files.', id: 'a1', role: 'assistant' },
    ];
    store.drainQueuedMessages = vi.fn(() => [{ content: 'follow up', id: 'q1' } as any]);
    store.queuedMessages = { [messageMapKey(CONTEXT)]: [{ content: 'follow up', id: 'q1' }] };
    store.messagesMap = { [messageMapKey(CONTEXT)]: messages } as any;
    store.topicDataMap = {
      [topicMapKey({ agentId: 'a1' })]: {
        items: [{ id: 't1', title: 'defaultTitle' }],
        total: 1,
      },
    } as any;

    const { requeued } = await lifecycle('gateway', get).completeRun(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(requeued).toBe(true);
    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', messages);
  });

  it.each<[AgentRuntimeType, RunTerminalStatus, 'completeOperation' | 'failOperation']>([
    ['gateway', 'completed', 'completeOperation'],
    ['gateway', 'failed', 'failOperation'],
    ['hetero', 'completed', 'completeOperation'],
    ['hetero', 'failed', 'failOperation'],
  ])('%s normalized `status: %s` drives op completion', async (runtimeType, status, completer) => {
    const { get, store } = makeStore();
    await lifecycle(runtimeType, get).completeRun(completeEvent(runtimeType, { status }));

    expect(store[completer]).toHaveBeenCalledWith(
      OP,
      ...(completer === 'failOperation' ? [expect.anything()] : []),
    );
  });

  it.each<AgentRuntimeType>(['gateway', 'hetero'])(
    '%s `status: cancelled` completes the op (cancel reaches this boundary still running) but does NOT fail it or mark unread',
    async (runtimeType) => {
      const { get, store } = makeStore();
      const { requeued } = await lifecycle(runtimeType, get).completeRun(
        completeEvent(runtimeType, { status: 'cancelled' }),
      );

      expect(requeued).toBe(false);
      expect(store.completeOperation).toHaveBeenCalledTimes(1);
      expect(store.completeOperation).toHaveBeenCalledWith(OP);
      expect(store.markTopicUnread).not.toHaveBeenCalled();
      expect(store.failOperation).not.toHaveBeenCalled();
    },
  );

  it('`status: cancelled` does not drain a pending queue', async () => {
    const { get, store } = makeStore();
    store.queuedMessages = { [messageMapKey(CONTEXT)]: [{ content: 'queued', id: 'q1' }] };

    const { requeued } = await lifecycle('gateway', get).completeRun(
      completeEvent('gateway', { status: 'cancelled' }),
    );

    expect(requeued).toBe(false);
    expect(store.completeOperation).toHaveBeenCalledWith(OP);
    expect(store.drainQueuedMessages).not.toHaveBeenCalled();
  });

  it('an unrecognized (missing) status leaves the op untouched', async () => {
    const { get, store } = makeStore();
    const { requeued } = await lifecycle('gateway', get).completeRun(completeEvent('gateway', {}));

    expect(requeued).toBe(false);
    expect(store.completeOperation).not.toHaveBeenCalled();
    expect(store.failOperation).not.toHaveBeenCalled();
  });

  it('skips every terminal effect once the op was reconciled from a server snapshot', async () => {
    const { get, store } = makeStore();
    (store.operations[OP].metadata as Record<string, unknown>).terminalReconciled = true;

    const { requeued } = await lifecycle('gateway', get).completeRun(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(requeued).toBe(false);
    expect(store.completeOperation).not.toHaveBeenCalled();
    expect(store.markTopicUnread).not.toHaveBeenCalled();
  });

  it.each<[AgentRuntimeType, RunTerminalStatus]>([
    ['gateway', 'completed'],
    ['gateway', 'failed'],
    ['hetero', 'cancelled'],
  ])(
    '%s `status: %s` never writes the topic status (transports own their own reset)',
    async (runtimeType, status) => {
      const { get, store } = makeStore();
      await lifecycle(runtimeType, get).completeRun(completeEvent(runtimeType, { status }));

      expect(store.updateTopicStatus).not.toHaveBeenCalled();
    },
  );
});

describe('buildRunLifecycle — sub-agent runs skip top-level effects', () => {
  it('a sub_agent success completes the op but does NOT drain the parent input queue', async () => {
    const { get, store } = makeStore();
    // Even with a queued follow-up present, a nested sub-agent completion must
    // NOT drain it — the queue belongs to the parent run.
    store.drainQueuedMessages = vi.fn(() => [{ content: 'queued', id: 'q1' } as any]);

    const { requeued } = await lifecycle('gateway', get, 'sub_agent').completeRun(
      completeEvent('gateway', { runScope: 'sub_agent', status: 'completed' }),
    );

    expect(requeued).toBe(false);
    expect(store.drainQueuedMessages).not.toHaveBeenCalled();
    // The op still completes so its loading clears.
    expect(store.completeOperation).toHaveBeenCalledWith(OP);
  });

  it('a top_level success with an empty queue completes without requeueing (contrast probe)', async () => {
    const { get, store } = makeStore();

    const { requeued } = await lifecycle('gateway', get, 'top_level').completeRun(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(requeued).toBe(false);
    expect(store.completeOperation).toHaveBeenCalledWith(OP);
  });

  it('keeps the queue in place until the steered send takes it', async () => {
    vi.useFakeTimers();
    try {
      const { get, store } = makeStore();
      const sendMessage = vi.fn(async () => {});
      (store as any).sendMessage = sendMessage;
      const queued = {
        content: 'queued',
        createdAt: 1,
        id: 'q1',
        interruptMode: 'soft',
        metadata: { scope: 'x' },
      } as any;
      store.queuedMessages = { [messageMapKey(CONTEXT)]: [queued] };
      store.drainQueuedMessages = vi.fn(() => [queued]);

      const { requeued } = await lifecycle('gateway', get, 'top_level').completeRun(
        completeEvent('gateway', { status: 'completed' }),
      );

      expect(requeued).toBe(true);
      expect(store.completeOperation).toHaveBeenCalledWith(OP);
      expect(store.drainQueuedMessages).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();

      expect(store.drainQueuedMessages).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'queued',
          metadata: expect.objectContaining({ scope: 'x', steer: true }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('afterRunComplete is a no-op for a sub_agent run (no notification)', async () => {
    const { get } = makeStore();
    // Resolves without touching the desktop notification path (early return on
    // runScope === 'sub_agent', before the isDesktop / dynamic-import branch).
    await expect(
      lifecycle('gateway', get, 'sub_agent').afterRunComplete(
        completeEvent('gateway', { runScope: 'sub_agent', status: 'completed' }),
      ),
    ).resolves.toBeUndefined();
    expect(desktopNotificationMock.notifyDesktopAgentCompleted).not.toHaveBeenCalled();
  });
});

describe('buildRunLifecycle.afterRunComplete — desktop notification and voice title', () => {
  const KEY = messageMapKey(CONTEXT);
  const thisTurnAssistant = {
    content: 'second turn reply',
    id: 'a-this',
    parentId: 'u1',
    role: 'assistant',
  } as any;
  const prevTurnAssistant = {
    content: 'first turn reply',
    id: 'a-prev',
    parentId: 'u-prev',
    role: 'assistant',
  } as any;

  it('derives the body from the last assistant in the store and sets the dock badge', async () => {
    const { get, store } = makeStore();
    store.messagesMap = { [KEY]: [prevTurnAssistant, thisTurnAssistant] } as any;

    await lifecycle('gateway', get).afterRunComplete(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(desktopNotificationMock.notifyDesktopAgentCompleted).toHaveBeenCalledTimes(1);
    expect(desktopNotificationMock.notifyDesktopAgentCompleted).toHaveBeenCalledWith(
      get,
      expect.objectContaining({
        badge: true,
        content: 'second turn reply',
        context: expect.objectContaining({ topicId: 't1', workspaceSlug: 'team' }),
      }),
    );
  });

  it('prefers executor-supplied notification content (hetero accContent) over the store', async () => {
    const { get, store } = makeStore();
    store.messagesMap = { [KEY]: [thisTurnAssistant] } as any;

    await lifecycle('hetero', get).afterRunComplete(
      completeEvent('hetero', {
        notification: { content: 'in-memory reply' },
        status: 'completed',
      }),
    );

    expect(desktopNotificationMock.notifyDesktopAgentCompleted).toHaveBeenCalledWith(
      get,
      expect.objectContaining({ content: 'in-memory reply' }),
    );
  });

  it('summarizes an untitled topic after its audio-only first message receives a reply', async () => {
    const { get, store } = makeStore();
    const voiceMessage = {
      audioList: [{ alt: 'voice.webm', id: 'audio-1', url: 'https://example.com/voice.webm' }],
      content: '',
      id: 'u1',
      role: 'user',
    } as any;
    const messages = [voiceMessage, thisTurnAssistant];
    store.messagesMap = { [KEY]: messages } as any;
    store.topicDataMap = {
      [topicMapKey({ agentId: 'a1' })]: {
        items: [{ id: 't1', title: 'defaultTitle' }],
        total: 1,
      },
    } as any;

    await lifecycle('gateway', get).afterRunComplete(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', messages);
  });

  it('summarizes an audio-first topic when the reply is grouped around a media tool call', async () => {
    const { get, store } = makeStore();
    const messages = [
      {
        audioList: [{ alt: 'voice.webm', id: 'audio-1', url: 'https://example.com/voice.webm' }],
        content: '',
        id: 'u1',
        role: 'user',
      },
      {
        children: [
          {
            content: 'Analyzing the recording.',
            id: 'assistant-tool',
            tools: [{ apiName: 'analyzeMedia', id: 'tool-1' }],
          },
          { content: 'The recording asks how to list files.', id: 'assistant-answer' },
        ],
        content: '',
        id: 'assistant-group',
        role: 'assistantGroup',
      },
    ];
    store.messagesMap = { [KEY]: messages } as any;
    store.topicDataMap = {
      [topicMapKey({ agentId: 'a1' })]: {
        items: [{ id: 't1', title: 'defaultTitle' }],
        total: 1,
      },
    } as any;

    await lifecycle('gateway', get).afterRunComplete(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', messages);
  });

  it.each(['failed', 'cancelled'] as const)(
    'does not summarize partial audio replies or notify when the run ends as %s',
    async (status) => {
      const { get, store } = makeStore();
      store.messagesMap = {
        [KEY]: [
          {
            audioList: [
              { alt: 'voice.webm', id: 'audio-1', url: 'https://example.com/voice.webm' },
            ],
            content: '',
            id: 'u1',
            role: 'user',
          },
          { ...thisTurnAssistant, content: 'Partial reply' },
        ],
      } as any;
      store.topicDataMap = {
        [topicMapKey({ agentId: 'a1' })]: {
          items: [{ id: 't1', title: 'defaultTitle' }],
          total: 1,
        },
      } as any;

      await lifecycle('gateway', get).afterRunComplete(completeEvent('gateway', { status }));

      expect(store.summaryTopicTitle).not.toHaveBeenCalled();
      expect(desktopNotificationMock.notifyDesktopAgentCompleted).not.toHaveBeenCalled();
    },
  );

  it('does not re-summarize a text-first topic after the reply completes', async () => {
    const { get, store } = makeStore();
    store.messagesMap = {
      [KEY]: [{ content: 'hello', id: 'u1', role: 'user' }, thisTurnAssistant],
    } as any;
    store.topicDataMap = {
      [topicMapKey({ agentId: 'a1' })]: {
        items: [{ id: 't1', title: 'defaultTitle' }],
        total: 1,
      },
    } as any;

    await lifecycle('gateway', get).afterRunComplete(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(store.summaryTopicTitle).not.toHaveBeenCalled();
  });
});

describe('buildRunLifecycle.afterUserMessagePersisted — topic title (all runtimes)', () => {
  const persistedEvent = (
    runtimeType: AgentRuntimeType,
    runScope: 'sub_agent' | 'top_level',
    fields: Partial<UserMessagePersistedEvent>,
  ): UserMessagePersistedEvent => ({
    context: CONTEXT,
    isCreateNewTopic: true,
    operationId: OP,
    runId: OP,
    runScope,
    runtimeType,
    topicId: 't1',
    ...fields,
  });

  it('new topic (top_level) summarizes the title with the caller-provided messages', async () => {
    const { get, store } = makeStore();
    const messages = [{ content: 'hello there', id: 'm1', role: 'user' } as any];

    await lifecycle('gateway', get, 'top_level').afterUserMessagePersisted(
      persistedEvent('gateway', 'top_level', { isCreateNewTopic: true, messages, topicId: 't1' }),
    );

    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', messages);
  });

  it('dev-slice title update writes the sliced title without calling the summarizer', async () => {
    const previous = process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC;
    process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC = '1';

    try {
      const { get, store } = makeStore();
      const messages = [
        { content: '阅读下面的材料，根据要求写作。', id: 'm1', role: 'user' } as any,
      ];

      await lifecycle('gateway', get, 'top_level').afterUserMessagePersisted(
        persistedEvent('gateway', 'top_level', {
          isCreateNewTopic: true,
          messages,
          topicId: 't1',
        }),
      );

      expect(store.internal_updateTopic).toHaveBeenCalledWith('t1', {
        title: '阅读下面的材料，根据要求写作。',
      });
      expect(store.summaryTopicTitle).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC;
      } else {
        process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC = previous;
      }
    }
  });

  it('loads the topic first when it is absent from the store (gateway fire-and-forget refreshTopic race)', async () => {
    const { get, store } = makeStore(); // topicMaps empty → getTopicById returns undefined
    const messages = [{ content: 'hi', id: 'm1', role: 'user' } as any];

    await lifecycle('gateway', get, 'top_level').afterUserMessagePersisted(
      persistedEvent('gateway', 'top_level', { isCreateNewTopic: true, messages, topicId: 't1' }),
    );

    // The new gateway topic isn't in the store yet → refreshTopic is awaited
    // before summarizing so summaryTopicTitle doesn't bail on a missing topic.
    expect(store.refreshTopic).toHaveBeenCalled();
    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', messages);
  });

  it('new topic (gateway, no caller messages) reads the store under the EVENT topicId, not the stale send-time context', async () => {
    // Regression (#16289 follow-up): the adapter is built with the send-time
    // `operationContext`, whose topicId is still null for a brand-new topic.
    // Gateway/hetero omit `event.messages` and persist the conversation under
    // the REAL topicId (carried on `event.context`). Reading the store with the
    // stale adapter context lands on an empty bucket, so the model summarizes
    // nothing and emits a degenerate "空对话标题" title.
    const { get, store } = makeStore();
    const storedMessages = [{ content: 'hello there', id: 'm1', role: 'user' } as any];
    // Send-time context: new topic not created yet, so no topicId.
    const sendContext = { agentId: 'a1', workspaceSlug: 'team' } as ConversationContext;
    // Event context: the freshly-created topic id the messages were persisted under.
    const eventContext = {
      agentId: 'a1',
      topicId: 't1',
      workspaceSlug: 'team',
    } as ConversationContext;
    store.messagesMap = { [messageMapKey(eventContext)]: storedMessages };

    const runLifecycle = buildRunLifecycle(get, {
      context: sendContext,
      parentMessageId: 'u1',
      parentMessageType: 'user',
      runId: OP,
      runScope: 'top_level',
      runtimeType: 'gateway',
    });

    await runLifecycle.afterUserMessagePersisted({
      context: eventContext,
      isCreateNewTopic: true,
      operationId: OP,
      runId: OP,
      runScope: 'top_level',
      runtimeType: 'gateway',
      topicId: 't1',
    });

    expect(store.summaryTopicTitle).toHaveBeenCalledWith('t1', storedMessages);
  });

  it('does NOT title for a sub_agent run', async () => {
    const { get, store } = makeStore();

    await lifecycle('gateway', get, 'sub_agent').afterUserMessagePersisted(
      persistedEvent('gateway', 'sub_agent', {
        isCreateNewTopic: true,
        messages: [{ content: 'x', id: 'm1', role: 'user' } as any],
      }),
    );

    expect(store.summaryTopicTitle).not.toHaveBeenCalled();
  });

  it('does nothing when no topicId is resolved', async () => {
    const { get, store } = makeStore();

    await lifecycle('hetero', get, 'top_level').afterUserMessagePersisted(
      persistedEvent('hetero', 'top_level', { isCreateNewTopic: true, topicId: undefined }),
    );

    expect(store.summaryTopicTitle).not.toHaveBeenCalled();
  });
});

describe('buildRunLifecycle.onRunResumed — park → resume broadcast seam', () => {
  const resumedEvent = (runtimeType: AgentRuntimeType, runScope: 'sub_agent' | 'top_level') => ({
    context: CONTEXT,
    operationId: OP,
    resumedOperationId: 'op2',
    runId: OP,
    runScope,
    runtimeType,
  });

  it.each<AgentRuntimeType>(['gateway', 'hetero'])(
    'is behavior-neutral for %s: fires NO terminal side effects',
    async (runtimeType) => {
      const { get, store } = makeStore();

      await expect(
        lifecycle(runtimeType, get).onRunResumed(resumedEvent(runtimeType, 'top_level')),
      ).resolves.toBeUndefined();

      // The run is continuing, not completing — none of the terminal mutations
      // (op completion / unread / queue drain) may fire.
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(store.failOperation).not.toHaveBeenCalled();
      expect(store.markTopicUnread).not.toHaveBeenCalled();
      expect(store.drainQueuedMessages).not.toHaveBeenCalled();
    },
  );

  it('is a no-op for a sub_agent resume (top-level only, like the other run-scoped hooks)', async () => {
    const { get, store } = makeStore();

    await expect(
      lifecycle('gateway', get, 'sub_agent').onRunResumed(resumedEvent('gateway', 'sub_agent')),
    ).resolves.toBeUndefined();

    expect(store.completeOperation).not.toHaveBeenCalled();
  });
});
