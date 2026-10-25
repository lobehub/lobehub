import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type { ChatStore } from '@/store/chat/store';

import { OperationActionsImpl } from './actions';
import { initialOperationState } from './initialState';
import { operationSelectors } from './selectors';
import type { OperationContext } from './types';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: vi.fn() },
}));

vi.mock('@/store/home', () => ({ getHomeStoreState: () => ({}) }));

const useChatStore = createStore<ChatStore>()(
  (set, get) =>
    ({
      ...initialOperationState,
      ...new OperationActionsImpl(set, get),
    }) as ChatStore,
);

describe('operation cancellation context and recovery', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
    vi.clearAllMocks();
  });

  it.each([
    { context: {}, scope: 'main' },
    { context: { groupId: 'group1' }, scope: 'group' },
    { context: { threadId: 'thread1' }, scope: 'thread' },
  ] as const)(
    'matches inferred $scope scope without crossing context boundaries',
    ({ context, scope }) => {
      const store = useChatStore.getState();
      const start = (extra: OperationContext = {}) =>
        store.startOperation({
          context: { agentId: 'agent1', topicId: 'topic1', ...context, ...extra },
          type: 'execServerAgentRuntime',
        }).operationId;
      const implicit = start();
      const explicit = start({ scope });
      const unrelated = [
        start({ agentId: 'other-agent' }),
        start({ topicId: 'other-topic' }),
        start({ scope: 'sub_agent' }),
        start({ scope: 'thread', threadId: 'other-thread' }),
        start({ groupId: 'other-group', scope: 'group' }),
        start({ scope: 'group_agent' }),
        start({ groupId: 'other-group', scope: undefined }),
        start({ scope: undefined, threadId: 'other-thread' }),
        start({ isNew: true, scope: 'thread', threadId: null }),
      ];

      expect(
        store.cancelOperations({
          agentId: 'agent1',
          groupId: 'groupId' in context ? context.groupId : undefined,
          scope,
          threadId: 'threadId' in context ? context.threadId : null,
          topicId: 'topic1',
        }),
      ).toEqual([implicit, explicit]);
      expect(unrelated.map((id) => useChatStore.getState().operations[id].status)).toEqual(
        unrelated.map(() => 'running'),
      );
    },
  );

  it('matches absent group and existing-conversation defaults without cancelling new contexts', () => {
    const store = useChatStore.getState();
    const start = (context: OperationContext) =>
      store.startOperation({
        context: { agentId: 'agent1', topicId: 'topic1', ...context },
        type: 'execServerAgentRuntime',
      }).operationId;
    const implicit = start({});
    const explicit = start({ isNew: false, scope: 'main' });
    const newConversation = start({ isNew: true, scope: 'main' });
    const groupConversation = start({ groupId: 'group1', isNew: false });

    expect(
      store.cancelOperations({
        agentId: 'agent1',
        groupId: null,
        isNew: false,
        scope: 'main',
        topicId: 'topic1',
      }),
    ).toEqual([implicit, explicit]);
    expect(useChatStore.getState().operations[newConversation].status).toBe('running');
    expect(useChatStore.getState().operations[groupConversation].status).toBe('running');
  });

  it.each(['reject', 'throw'] as const)(
    'restores Stop and supports retry after handlers %s',
    async (failure) => {
      const store = useChatStore.getState();
      const context = { agentId: 'agent1', scope: 'main' as const, topicId: 'topic1' };
      const { operationId } = store.startOperation({ context, type: 'execServerAgentRuntime' });
      const handler = vi
        .fn()
        .mockImplementationOnce(() => {
          if (failure === 'throw') throw new Error('cancel unavailable');
          return Promise.reject(new Error('cancel unavailable'));
        })
        .mockResolvedValue(undefined);
      store.onOperationCancel(operationId, handler);

      await expect(store.cancelOperation(operationId)).resolves.toBe(false);
      const failedState = useChatStore.getState();
      expect(failedState.operations[operationId].status).toBe('running');
      expect(failedState.operations[operationId].metadata.isAborting).toBeFalsy();
      expect(operationSelectors.isAgentRuntimeRunningByContext(context)(failedState)).toBe(true);

      await expect(store.cancelOperation(operationId)).resolves.toBe(true);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(useChatStore.getState().operations[operationId].status).toBe('cancelled');
    },
  );

  it('reports a failed batch cancellation and leaves it available for retry', async () => {
    const store = useChatStore.getState();
    const { operationId } = store.startOperation({
      context: { agentId: 'agent1' },
      type: 'execServerAgentRuntime',
    });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue(undefined);
    store.onOperationCancel(operationId, handler);

    expect(store.cancelOperations({ agentId: 'agent1', scope: 'main' })).toEqual([operationId]);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(useChatStore.getState().operations[operationId].metadata.isAborting).toBeFalsy();
    expect(store.cancelOperations({ agentId: 'agent1', scope: 'main' })).toEqual([operationId]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(useChatStore.getState().operations[operationId].status).toBe('cancelled');
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
