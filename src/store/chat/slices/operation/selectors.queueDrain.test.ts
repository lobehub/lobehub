import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { operationSelectors } from './selectors';
import type { OperationMetadata, OperationType } from './types';

const context = { agentId: 'agent1', topicId: 'topic1' };

const startQueuedRun = (type: OperationType, metadata?: OperationMetadata) => {
  const { result } = renderHook(() => useChatStore());

  act(() => {
    result.current.startOperation({ context, metadata, type });
    result.current.enqueueMessage(messageMapKey(context), {
      content: 'follow up',
      createdAt: Date.now(),
      id: 'q1',
      interruptMode: 'soft',
    });
  });

  return operationSelectors.isQueueDrainedAtRunEnd(context)(result.current);
};

describe('isQueueDrainedAtRunEnd', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  // ROOT CAUSE:
  //
  // QueueTray picked its send-timing caption from the conversation agent's
  // config (`heterogeneousProvider`). That differs from the run actually
  // blocking the queue: a legacy CLI agent recovered from its model id has no
  // provider field, and an `@Agent` route runs another agent under the owner's
  // context. Those CLI runs still promised "current step".
  //
  // Before: the caption followed the owner agent's config.
  // After: it follows the queue-blocking operation's runtime.
  it('waits for a local CLI run, whatever the agent config says', () => {
    expect(startQueuedRun('execHeterogeneousAgent')).toBe(true);
  });

  it('waits for a Gateway run the server dispatched to a CLI producer', () => {
    expect(startQueuedRun('execServerAgentRuntime', { heteroType: 'claude-code' })).toBe(true);
  });

  it('hands back at the next step for the native runtime', () => {
    expect(startQueuedRun('execServerAgentRuntime', { heteroType: null })).toBe(false);
    expect(startQueuedRun('execAgentRuntime')).toBe(false);
  });

  // ROOT CAUSE:
  //
  // During a rolling deploy an older server returns no `heteroType` for either
  // runtime. Reading that as native promised "current step" behind a CLI run
  // that only drains its queue at run end.
  //
  // Before: an unreported producer counted as the native runtime.
  // After: it may be a CLI run, so the caption promises the later timing.
  it('treats an unreported producer as a possible CLI run', () => {
    expect(startQueuedRun('execServerAgentRuntime')).toBe(true);
  });

  it('follows the supervisor, not a group member run under it', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      const { operationId: supervisorId } = result.current.startOperation({
        context,
        metadata: { heteroType: null },
        type: 'execServerAgentRuntime',
      });
      result.current.startOperation({
        context,
        parentOperationId: supervisorId,
        type: 'execServerAgentRuntime',
      });
      result.current.enqueueMessage(messageMapKey(context), {
        content: 'follow up',
        createdAt: Date.now(),
        id: 'q1',
        interruptMode: 'soft',
      });
    });

    expect(operationSelectors.isQueueDrainedAtRunEnd(context)(result.current)).toBe(false);
  });

  // ROOT CAUSE:
  //
  // A Gateway CLI socket that closes without its terminal completes the local
  // op but leaves the external producer and its queue alive until
  // `heteroFinish`. Requiring a queue-blocking op flipped the still-visible
  // queue back to "current step".
  //
  // Before: only a running queue-blocking op could promise run-end timing.
  // After: with nothing running, the queue's idle host decides.
  it('keeps waiting for a CLI run whose socket closed before its terminal', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      const { operationId } = result.current.startOperation({
        context,
        metadata: { heteroType: 'claude-code' },
        type: 'execServerAgentRuntime',
      });
      result.current.enqueueMessage(messageMapKey(context), {
        content: 'follow up',
        createdAt: Date.now(),
        id: 'q1',
        interruptMode: 'soft',
      });
      result.current.completeOperation(operationId);
    });

    expect(operationSelectors.isQueueDrainedAtRunEnd(context)(result.current)).toBe(true);
  });

  it('does not let an idle native host promise run-end timing', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      const { operationId } = result.current.startOperation({
        context,
        metadata: { heteroType: null },
        type: 'execServerAgentRuntime',
      });
      result.current.enqueueMessage(messageMapKey(context), {
        content: 'follow up',
        createdAt: Date.now(),
        id: 'q1',
        interruptMode: 'soft',
      });
      result.current.completeOperation(operationId);
    });

    expect(operationSelectors.isQueueDrainedAtRunEnd(context)(result.current)).toBe(false);
  });
});
