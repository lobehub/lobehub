import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleMemberRunParkExit } from '../memberRunParkExit';

vi.mock('@/store/chat/agents/transports/clientSubAgentBridge', () => ({
  registerGroupBridgeFromParkExit: vi.fn(),
}));

vi.mock('@/store/chat/utils/messageMapKey', () => ({
  messageMapKey: vi.fn(() => 'main_supervisor_topic-1'),
}));

const makeGet = (overrides: Record<string, any> = {}) => {
  const store = {
    dbMessagesMap: {
      'main_supervisor_topic-1': [
        {
          id: 'tool-msg-1',
          pluginState: { status: 'running' },
          role: 'tool',
        },
      ],
    },
    optimisticUpdateMessageContent: vi.fn().mockResolvedValue(undefined),
    optimisticUpdatePluginState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
  return { get: () => store, store };
};

const baseParams = {
  agentId: 'agent-a',
  messageContext: {
    agentId: 'supervisor',
    groupId: 'group-1',
    scope: 'group',
    topicId: 'topic-1',
  } as any,
  orchestrationOperationId: 'op_orch',
  sessionLogId: 'log-1',
  state: { operationId: 'op_orch' } as any,
  subContext: {
    agentId: 'agent-a',
    scope: 'thread',
    threadId: 'thd_child',
    topicId: 'topic-1',
  } as any,
  supervisorAgentId: 'supervisor',
  taskOperationId: 'op_task',
  toolMessageId: 'tool-msg-1',
};

describe('handleMemberRunParkExit optimistic-write containment (round-22)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the nonterminal result even when both optimistic writes keep failing', async () => {
    const { store } = makeGet({
      optimisticUpdateMessageContent: vi.fn().mockRejectedValue(new Error('transient')),
      optimisticUpdatePluginState: vi.fn().mockRejectedValue(new Error('transient')),
    });

    // The bounded retry awaits real timers — advance the fake clock while
    // the park exit is in flight (5s+10s+15s backoff per write).
    const pending = handleMemberRunParkExit({ ...baseParams, get: () => store });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    // The nonterminal park exit must survive write failures: the enclosing
    // executor catch turns any rejection into a terminal
    // `task_completed { success: false }`, but `runtimeResult.parked`
    // already established the member is still active.
    expect(result.result).toBeUndefined();
    expect(result.events).toEqual([]);
    // 4 attempts per write, then containment (no throw).
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledTimes(4);
    expect(store.optimisticUpdatePluginState).toHaveBeenCalledTimes(4);
  });

  it('recovers a transient first failure and still returns the nonterminal result', async () => {
    const { store } = makeGet({
      optimisticUpdateMessageContent: vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(undefined),
    });

    const pending = handleMemberRunParkExit({ ...baseParams, get: () => store });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.result).toBeUndefined();
    // Second attempt succeeded.
    expect(store.optimisticUpdateMessageContent).toHaveBeenCalledTimes(2);
    expect(store.optimisticUpdatePluginState).toHaveBeenCalledTimes(1);
  });
});
