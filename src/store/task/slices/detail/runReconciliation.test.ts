import type { TaskDetailActivity, TaskDetailData } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { taskService } from '@/services/task';
import { useChatStore } from '@/store/chat';
import { buildRunLifecycle } from '@/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle';
import { initialOperationState } from '@/store/chat/slices/operation/initialState';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { useTaskStore } from '@/store/task';

const context = { agentId: 'agent-1', scope: 'main' as const, topicId: 'topic-1' };
const marker = { assistantMessageId: 'assistant-1', heteroType: null, operationId: 'server-1' };
const completedAt = '2026-10-08T13:45:12.419Z';
const visiblyRunning = () =>
  operationSelectors.isAgentRuntimeVisiblyRunningByContext(context)(useChatStore.getState());

const fetchDetail = async (activity: Partial<TaskDetailActivity> = {}) => {
  vi.mocked(taskService.getDetail).mockResolvedValue({
    data: {
      activities: [
        {
          completedAt,
          id: context.topicId,
          operationId: marker.operationId,
          runningOperation: null,
          status: 'completed',
          type: 'topic',
          ...activity,
        },
      ],
      identifier: 'T-3',
      status: 'scheduled',
    } as TaskDetailData,
    success: true,
  });
  await useTaskStore.getState().fetchTaskDetail('T-3');
};

describe('task run terminal reconciliation', () => {
  beforeEach(() => {
    useChatStore.setState({
      ...initialOperationState,
      activeAgentId: context.agentId,
      activeTopicId: context.topicId,
      gatewayConnections: {},
      messagesMap: {},
      topicDataMap: {},
      toolCallingStreamIds: {},
    });
    useTaskStore.setState({ taskDetailMap: {} });
    const server = createServerConfigStore();
    server.setState({
      serverConfig: {
        ...server.getState().serverConfig,
        agentGatewayUrl: 'https://gateway.invalid',
      },
    });
    vi.spyOn(aiAgentService, 'refreshGatewayToken').mockResolvedValue({ token: 'test-token' });
    vi.spyOn(aiAgentService, 'interruptTask').mockRejectedValue(new Error('must not interrupt'));
    vi.spyOn(taskService, 'getDetail');
    // Drop all socket events, including the terminal frame. Reconnect and both
    // stores remain real: the detail response must retire the stranded runtime.
    vi.spyOn(useChatStore.getState(), 'connectToGateway').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const reconnect = async () => {
    await useChatStore.getState().reconnectToGatewayOperation({ ...marker, ...context });
    return Object.values(useChatStore.getState().operations).find(
      (op) => op.metadata.serverOperationId === marker.operationId,
    )!;
  };

  it('ends the timer and owned loading after a completed detail response without a socket terminal', async () => {
    const root = await reconnect();
    const { operationId: childId } = useChatStore
      .getState()
      .startOperation({ parentOperationId: root.id, type: 'reasoning' });
    expect(visiblyRunning()).toBe(true);

    await fetchDetail();

    expect(visiblyRunning()).toBe(false);
    expect(useChatStore.getState().operations[root.id].status).toBe('completed');
    expect(useChatStore.getState().operations[childId].status).toBe('completed');
    expect(root.abortController.signal.aborted).toBe(false);
    expect(aiAgentService.interruptTask).not.toHaveBeenCalled();
  });

  it.each(['running', 'pending', 'waiting_for_human', undefined])(
    'does not infer completion from an absent marker (%s)',
    async (status) => {
      await reconnect();
      await fetchDetail({ status });
      expect(visiblyRunning()).toBe(true);
    },
  );

  it('requires the completed run identity', async () => {
    await reconnect();
    await fetchDetail({ operationId: null });
    expect(visiblyRunning()).toBe(true);
  });

  it('does not settle a contradictory snapshot that still marks the same run live', async () => {
    await reconnect();
    await fetchDetail({ runningOperation: marker });
    expect(visiblyRunning()).toBe(true);
  });

  it('does not touch another topic or revive an already failed child', async () => {
    const root = await reconnect();
    const { operationId: childId } = useChatStore
      .getState()
      .startOperation({ parentOperationId: root.id, type: 'reasoning' });
    useChatStore.getState().failOperation(childId, { message: 'existing failure', type: 'test' });
    const { operationId: otherId } = useChatStore.getState().startOperation({
      context: { ...context, topicId: 'other-topic' },
      metadata: { serverOperationId: marker.operationId },
      type: 'execServerAgentRuntime',
    });
    await fetchDetail();
    expect(useChatStore.getState().operations[otherId].status).toBe('running');
    expect(useChatStore.getState().operations[childId].status).toBe('failed');
    expect(visiblyRunning()).toBe(false);
  });

  it('leaves a successor and its queued input alone when an older run finishes', async () => {
    const old = await reconnect();
    const { operationId: next } = useChatStore.getState().startOperation({
      context,
      metadata: { serverOperationId: 'server-2' },
      type: 'execServerAgentRuntime',
    });
    useChatStore.getState().enqueueMessage(messageMapKey(context), {
      content: 'for the new run',
      createdAt: Date.now(),
      id: 'queued-new',
      interruptMode: 'hard',
    });
    await fetchDetail();
    expect(useChatStore.getState().operations[old.id].status).toBe('completed');
    expect(useChatStore.getState().operations[next].status).toBe('running');
    expect(visiblyRunning()).toBe(true);
    expect(useChatStore.getState().queuedMessages[messageMapKey(context)]).toHaveLength(1);
  });

  it.each([
    ['failed', 'failed'],
    ['timeout', 'failed'],
    ['canceled', 'cancelled'],
  ])('preserves a %s outcome', async (status, expected) => {
    const root = await reconnect();
    await fetchDetail({ status });
    expect(useChatStore.getState().operations[root.id].status).toBe(expected);
    // Transport completion can still arrive after the authoritative read.
    useChatStore.getState().completeOperation(root.id);
    expect(useChatStore.getState().operations[root.id].status).toBe(expected);
    expect(visiblyRunning()).toBe(false);
  });

  it('does not reconnect a run that finished while its token was refreshing', async () => {
    let resolveToken!: (value: { token: string }) => void;
    vi.mocked(aiAgentService.refreshGatewayToken).mockReturnValue(
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
    );
    const pending = useChatStore.getState().reconnectToGatewayOperation({ ...marker, ...context });
    expect(visiblyRunning()).toBe(true);
    await fetchDetail();
    resolveToken({ token: 'late-token' });
    await pending;
    expect(visiblyRunning()).toBe(false);
    expect(useChatStore.getState().connectToGateway).not.toHaveBeenCalled();
  });

  it('continues queued input once and ignores a late terminal lifecycle', async () => {
    vi.useFakeTimers();
    const root = await reconnect();
    const send = vi.spyOn(useChatStore.getState(), 'sendMessage').mockResolvedValue(undefined);
    const hook = vi.fn();
    useChatStore
      .getState()
      .updateOperationMetadata(root.id, { runtimeHooks: { afterCompletionCallbacks: [hook] } });
    useChatStore.getState().enqueueMessage(messageMapKey(context), {
      content: 'queued follow-up',
      createdAt: Date.now(),
      id: 'queued-1',
      interruptMode: 'hard',
    });
    await fetchDetail();
    await fetchDetail();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledOnce();
    expect(useChatStore.getState().queuedMessages[messageMapKey(context)]).toHaveLength(0);

    const lifecycle = buildRunLifecycle(useChatStore.getState, {
      context,
      parentMessageId: marker.assistantMessageId,
      parentMessageType: 'assistant',
      runId: root.id,
      runScope: 'top_level',
      runtimeType: 'gateway',
    });
    await lifecycle.completeRun({
      context,
      operationId: root.id,
      runId: root.id,
      runScope: 'top_level',
      runtimeType: 'gateway',
      status: 'completed',
    });
    expect(hook).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps newly queued input with a successor started during the recovery hand-off', async () => {
    vi.useFakeTimers();
    await reconnect();
    const send = vi.spyOn(useChatStore.getState(), 'sendMessage').mockResolvedValue(undefined);
    const key = messageMapKey(context);
    useChatStore.getState().enqueueMessage(key, {
      content: 'follow up',
      createdAt: Date.now(),
      id: 'queued',
      interruptMode: 'hard',
    });
    await fetchDetail();
    useChatStore.getState().startOperation({
      context,
      metadata: { serverOperationId: 'server-next' },
      type: 'execServerAgentRuntime',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(send).not.toHaveBeenCalled();
    expect(useChatStore.getState().queuedMessages[key]).toHaveLength(1);
    expect(visiblyRunning()).toBe(true);
  });
});
