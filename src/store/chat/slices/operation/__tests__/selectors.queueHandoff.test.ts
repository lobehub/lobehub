import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { operationSelectors } from '../selectors';

const context = { agentId: 'agent1', topicId: 'topic1' };

const queueBehind = (result: { current: ReturnType<typeof useChatStore.getState> }) =>
  result.current.enqueueMessage(messageMapKey(context), {
    content: 'follow up',
    createdAt: 2000,
    id: 'q1',
    interruptMode: 'soft',
  });

describe('queue hand-off after a run stopped elsewhere', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  // ROOT CAUSE:
  //
  // A Gateway run stopped from another tab, device or the API ends with
  // `agent_runtime_end(interrupted)`; the lifecycle settles it as `completed`,
  // the same as a clean finish. With a follow-up queued, the selectors read
  // that as the hand-off to the next turn, which never comes, so the input
  // kept loading ("running") for as long as the page stayed open.
  //
  // Before: a completed host always counted as handing its queue off.
  // After: one that ended without completing does not.
  it('does not keep the input loading behind a run that ended without completing', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      const { operationId } = result.current.startOperation({
        context,
        metadata: { startTime: 1000 },
        type: 'execServerAgentRuntime',
      });
      queueBehind(result);
      result.current.completeOperation(operationId);
      result.current.updateOperationMetadata(operationId, { endedWithoutCompletion: true });
    });

    expect(operationSelectors.isSteerHandoffPending(context)(result.current)).toBe(false);
    expect(operationSelectors.isQueueDrainPending(context)(result.current)).toBe(false);
    expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(false);
  });

  it('still hands the queue off behind a run that completed', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      const { operationId } = result.current.startOperation({
        context,
        metadata: { startTime: 1000 },
        type: 'execServerAgentRuntime',
      });
      queueBehind(result);
      result.current.completeOperation(operationId);
    });

    expect(operationSelectors.isSteerHandoffPending(context)(result.current)).toBe(true);
    expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(true);
  });
});

describe('restoreQueuedMessage', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  it('puts a message back at its place in the queue', () => {
    const key = messageMapKey(context);
    const item = (id: string) => ({
      content: id,
      createdAt: 1,
      id,
      interruptMode: 'soft' as const,
    });
    useChatStore.getState().enqueueMessage(key, item('a'));
    useChatStore.getState().enqueueMessage(key, item('c'));

    useChatStore.getState().restoreQueuedMessage(key, item('b'), 1);

    expect(useChatStore.getState().queuedMessages[key].map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
