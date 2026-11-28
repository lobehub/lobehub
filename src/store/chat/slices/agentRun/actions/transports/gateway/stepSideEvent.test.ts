import { describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { resolveStepSideEvent } from './stepSideEvent';

const context = { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any;
const dispatchContext = { operationId: 'local-op' };

const task = {
  description: 'ping',
  startedAt: 1,
  status: 'running',
  taskId: 'b1',
  toolName: 'Bash',
};

const createStore = () => {
  const store = {
    dbMessagesMap: {
      [messageMapKey(context)]: [
        { id: 'msg-assistant', role: 'assistant' },
        { id: 'msg-tool', role: 'tool', tool_call_id: 'toolu_bash' },
      ],
    },
    internal_dispatchMessage: vi.fn(),
  };
  return { get: () => store as any, store };
};

describe('resolveStepSideEvent background_task', () => {
  it('patches the snapshot onto the starting tool row with the server operation', () => {
    const { get, store } = createStore();
    const side = resolveStepSideEvent(
      get,
      {
        data: { task, toolCallId: 'toolu_bash' },
        operationId: 'server-op',
        type: 'background_task',
      },
      context,
      dispatchContext,
    );

    side?.apply?.();
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'msg-tool',
        key: 'backgroundTask',
        type: 'updatePluginState',
        value: { ...task, operationId: 'server-op' },
      },
      dispatchContext,
    );
  });

  it('waits for the refetch when the tool row is not loaded yet', () => {
    const { get, store } = createStore();
    const side = resolveStepSideEvent(
      get,
      {
        data: { task, toolCallId: 'toolu_other' },
        operationId: 'server-op',
        type: 'background_task',
      },
      context,
      dispatchContext,
    );

    side?.apply?.();
    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
  });

  it('is consumed even when malformed, so it never counts as a step boundary', () => {
    const { get } = createStore();
    expect(
      resolveStepSideEvent(
        get,
        { data: {}, operationId: 'op', type: 'background_task' },
        context,
        dispatchContext,
      ),
    ).toEqual({});
  });

  it('leaves a real step boundary to the handler', () => {
    const { get } = createStore();
    expect(
      resolveStepSideEvent(
        get,
        { data: { phase: 'execution_complete' }, operationId: 'op', type: 'step_complete' },
        context,
        dispatchContext,
      ),
    ).toBeUndefined();
  });
});
