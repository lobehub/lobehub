import type { ConversationContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import type { AgentRuntimeType } from '../agentDispatcher';
import { buildRunLifecycle } from './buildRunLifecycle';
import type { RunCompleteEvent, RunTerminalStatus } from './types';

const agentSignalBridgeMock = vi.hoisted(() => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/chat/slices/aiChat/actions/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: agentSignalBridgeMock.emitClientAgentSignalSourceEvent,
}));

const OP = 'op1';
const CONTEXT: ConversationContext = { agentId: 'a1', topicId: 't1' } as ConversationContext;

const makeStore = (afterCompletionCallbacks?: Array<() => void>) => {
  const store = {
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    drainQueuedMessages: vi.fn(() => []),
    failOperation: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {},
    operations: {
      [OP]: {
        context: { agentId: 'a1', topicId: 't1' },
        metadata: afterCompletionCallbacks ? { runtimeHooks: { afterCompletionCallbacks } } : {},
        status: 'running',
      },
    },
  };
  return { get: (() => store) as unknown as () => ChatStore, store };
};

const lifecycle = (runtimeType: AgentRuntimeType, get: () => ChatStore) =>
  buildRunLifecycle(get, {
    context: CONTEXT,
    parentMessageId: 'u1',
    parentMessageType: 'user',
    runId: OP,
    runScope: 'top_level',
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
