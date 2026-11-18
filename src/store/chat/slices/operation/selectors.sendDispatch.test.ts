import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';

import { operationSelectors } from './selectors';

const context = { agentId: 'agent1', topicId: 'topic1' };
const isPending = () =>
  operationSelectors.isSendDispatchPendingByContext(context)(useChatStore.getState());

describe('isSendDispatchPendingByContext', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  it('is pending from the send until the run it hands off to starts', () => {
    let sendOpId = '';
    act(() => {
      sendOpId = useChatStore
        .getState()
        .startOperation({ context, type: 'sendMessage' }).operationId;
    });
    expect(isPending()).toBe(true);

    act(() => {
      useChatStore.getState().startOperation({
        context,
        parentOperationId: sendOpId,
        type: 'execServerAgentRuntime',
      });
      useChatStore.getState().completeOperation(sendOpId);
    });
    expect(isPending()).toBe(false);
  });

  it('is not pending while only a run is going', () => {
    act(() => {
      useChatStore.getState().startOperation({ context, type: 'execHeterogeneousAgent' });
    });

    expect(isPending()).toBe(false);
  });

  it('ignores a send in another conversation', () => {
    act(() => {
      useChatStore
        .getState()
        .startOperation({ context: { ...context, topicId: 'topic2' }, type: 'sendMessage' });
    });

    expect(isPending()).toBe(false);
  });
});
