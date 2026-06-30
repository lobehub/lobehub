import type { ConversationContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import type { AgentRuntimeType } from '../dispatch/agentDispatcher';
import { buildRunLifecycle } from './buildRunLifecycle';
import type { RunCompleteEvent, RunTerminalStatus, UserMessagePersistedEvent } from './types';

const agentSignalBridgeMock = vi.hoisted(() => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: agentSignalBridgeMock.emitClientAgentSignalSourceEvent,
}));

const OP = 'op1';
const CONTEXT: ConversationContext = { agentId: 'a1', topicId: 't1' } as ConversationContext;

const makeStore = (afterCompletionCallbacks?: Array<() => void>) => {
  const store = {
    activeAgentId: 'a1',
    activeGroupId: undefined,
    activeTopicId: 't1',
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    drainQueuedMessages: vi.fn(() => []),
    failOperation: vi.fn(),
    internal_updateTopic: vi.fn(),
    internal_updateTopicLoading: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {},
    operations: {
      [OP]: {
        context: { agentId: 'a1', topicId: 't1' },
        metadata: afterCompletionCallbacks ? { runtimeHooks: { afterCompletionCallbacks } } : {},
        status: 'running',
      },
    },
    refreshTopic: vi.fn(async () => {}),
    summaryTopicTitle: vi.fn(),
    // topicDataMap / messagesMap reads default to empty (no topic, no messages).
    topicDataMap: {},
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
  agentSignalBridgeMock.emitClientAgentSignalSourceEvent.mockClear();
});

describe('buildRunLifecycle.completeRun — transport-driven disposition', () => {
  it('client `runtimeStatus: done` completes the op, marks unread, and emits client.runtime.complete', async () => {
    const { get, store } = makeStore();
    await lifecycle('client', get).completeRun(completeEvent('client', { runtimeStatus: 'done' }));

    expect(store.completeOperation).toHaveBeenCalledWith(OP);
    expect(store.markTopicUnread).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'a1', topicId: 't1' }),
    );
    expect(store.failOperation).not.toHaveBeenCalled();
    expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ operationId: OP, status: 'completed' }),
        sourceType: 'client.runtime.complete',
      }),
    );
  });

  it.each<[RunTerminalStatus, 'completeOperation' | 'failOperation']>([
    ['completed', 'completeOperation'],
    ['failed', 'failOperation'],
  ])(
    'gateway normalized `status: %s` drives the same op completion WITHOUT emitting client.runtime.complete',
    async (status, completer) => {
      const { get, store } = makeStore();
      await lifecycle('gateway', get).completeRun(completeEvent('gateway', { status }));

      expect(store[completer]).toHaveBeenCalledWith(
        OP,
        ...(completer === 'failOperation' ? [expect.anything()] : []),
      );
      // The client-only signal must NOT fire for gateway.
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).not.toHaveBeenCalled();
    },
  );

  it('gateway `status: cancelled` completes the op (cancel reaches this boundary still running) but does NOT fail it or emit', async () => {
    const { get, store } = makeStore();
    await lifecycle('gateway', get).completeRun(completeEvent('gateway', { status: 'cancelled' }));

    // Unlike the client (whose cancel path completes the op out of band),
    // gateway/hetero reach completeRun with the op still `running`, so cancelled
    // must move it to terminal here. No markUnread, no failOperation, no signal.
    expect(store.completeOperation).toHaveBeenCalledWith(OP);
    expect(store.markTopicUnread).not.toHaveBeenCalled();
    expect(store.failOperation).not.toHaveBeenCalled();
    expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).not.toHaveBeenCalled();
  });

  it('client `runtimeStatus: interrupted` does NOT complete the op (cancel already moved it out of band)', async () => {
    const { get, store } = makeStore();
    await lifecycle('client', get).completeRun(
      completeEvent('client', { runtimeStatus: 'interrupted' }),
    );

    expect(store.completeOperation).not.toHaveBeenCalled();
    expect(store.failOperation).not.toHaveBeenCalled();
  });

  it('runs afterCompletion callbacks on every terminal regardless of transport', async () => {
    const cb = vi.fn();
    const { get } = makeStore([cb]);
    await lifecycle('hetero', get).completeRun(completeEvent('hetero', { status: 'completed' }));

    expect(cb).toHaveBeenCalledTimes(1);
  });
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

  it('a top_level success DOES drain the queue (contrast probe)', async () => {
    const { get, store } = makeStore();
    store.drainQueuedMessages = vi.fn(() => []);

    await lifecycle('gateway', get, 'top_level').completeRun(
      completeEvent('gateway', { status: 'completed' }),
    );

    expect(store.drainQueuedMessages).toHaveBeenCalled();
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

  it('dev-slice title update does not clear the client runtime loading owner', async () => {
    const previous = process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC;
    process.env.NEXT_PUBLIC_DEV_DISABLE_AUTO_TOPIC = '1';

    try {
      const { get, store } = makeStore();
      const messages = [
        { content: '阅读下面的材料，根据要求写作。', id: 'm1', role: 'user' } as any,
      ];

      await lifecycle('client', get, 'top_level').afterUserMessagePersisted(
        persistedEvent('client', 'top_level', {
          isCreateNewTopic: true,
          messages,
          topicId: 't1',
        }),
      );

      expect(store.internal_updateTopic).toHaveBeenCalledWith('t1', {
        title: '阅读下面的材料，根据要求写作。',
      });
      expect(store.internal_updateTopicLoading).not.toHaveBeenCalledWith('t1', false);
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

  it('does NOT title for a sub_agent run', async () => {
    const { get, store } = makeStore();

    await lifecycle('client', get, 'sub_agent').afterUserMessagePersisted(
      persistedEvent('client', 'sub_agent', {
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

  it.each<AgentRuntimeType>(['client', 'gateway', 'hetero'])(
    'is behavior-neutral for %s: fires NO terminal side effects and emits no completion signal',
    async (runtimeType) => {
      const { get, store } = makeStore();

      await expect(
        lifecycle(runtimeType, get).onRunResumed(resumedEvent(runtimeType, 'top_level')),
      ).resolves.toBeUndefined();

      // The run is continuing, not completing — none of the terminal mutations
      // (op completion / unread / queue drain) nor the completion signal may fire.
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(store.failOperation).not.toHaveBeenCalled();
      expect(store.markTopicUnread).not.toHaveBeenCalled();
      expect(store.drainQueuedMessages).not.toHaveBeenCalled();
      expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).not.toHaveBeenCalled();
    },
  );

  it('is a no-op for a sub_agent resume (top-level only, like the other run-scoped hooks)', async () => {
    const { get, store } = makeStore();

    await expect(
      lifecycle('client', get, 'sub_agent').onRunResumed(resumedEvent('client', 'sub_agent')),
    ).resolves.toBeUndefined();

    expect(store.completeOperation).not.toHaveBeenCalled();
    expect(agentSignalBridgeMock.emitClientAgentSignalSourceEvent).not.toHaveBeenCalled();
  });
});
