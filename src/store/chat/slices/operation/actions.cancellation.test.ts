import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import type { ChatStore } from '@/store/chat/store';
import { RunStopUnconfirmedError } from '@/store/chat/utils/runStop';

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

  describe('a device run whose stop the server could not confirm (T-14643)', () => {
    const startDeviceRun = () =>
      useChatStore.getState().startOperation({
        context: { agentId: 'agent1', topicId: 'topic1' },
        type: 'execServerAgentRuntime',
      }).operationId;

    it('says why the stop failed and forces it on request', async () => {
      const store = useChatStore.getState();
      const operationId = startDeviceRun();
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new RunStopUnconfirmedError('unconfirmed', 'runner_unreachable'))
        .mockResolvedValue(undefined);
      store.onOperationCancel(operationId, handler);

      store.cancelOperations({ agentId: 'agent1', scope: 'main', topicId: 'topic1' });
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());

      // The run stays live, and the reason is kept for the retry.
      const restored = useChatStore.getState().operations[operationId];
      expect(restored.status).toBe('running');
      expect(restored.metadata.stopFailureReason).toBe('runner_unreachable');

      const options = vi.mocked(toast.error).mock.calls[0][0] as any;
      // The rendered copy names the cause instead of a bare "try again".
      expect(options.description).toContain('is offline or no longer holds the run');
      expect(options.actions).toHaveLength(1);
      expect(options.actions[0].label).toBe('Force end');

      options.actions[0].onClick();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
      // The second cancel asks the server to end the run anyway.
      expect(handler.mock.calls[1][0].metadata.forceStop).toBe(true);
      await vi.waitFor(() =>
        expect(useChatStore.getState().operations[operationId].status).toBe('cancelled'),
      );
    });

    it('offers no force when the failure carries no server reason', async () => {
      const store = useChatStore.getState();
      const operationId = startDeviceRun();
      store.onOperationCancel(operationId, vi.fn().mockRejectedValue(new Error('network')));

      store.cancelOperations({ agentId: 'agent1', scope: 'main', topicId: 'topic1' });
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());

      const options = vi.mocked(toast.error).mock.calls[0][0] as any;
      expect(options.actions).toBeUndefined();
      expect(useChatStore.getState().operations[operationId].metadata.stopFailureReason).toBe(
        undefined,
      );
    });
  });
});
