import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatTopic } from '@/types/topic';

import { useFetchActiveTopicDetail } from './useFetchActiveTopicDetail';
import { useGatewayReconnect } from './useGatewayReconnect';
import { useOperationState } from './useOperationState';

const config = vi.hoisted(() => ({ serverConfig: { agentGatewayUrl: 'wss://gateway.test' } }));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof config) => unknown) => selector(config),
}));

const context = { agentId: 'agent-cr', topicId: 'topic-cr' };
const topic = {
  createdAt: new Date(),
  id: context.topicId,
  metadata: {},
  status: 'active',
  title: 'Review feedback',
  updatedAt: new Date(),
} as ChatTopic;
const runningOperation = {
  assistantMessageId: 'assistant-cr',
  heteroType: 'claude-code',
  operationId: 'server-cr',
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const useConversation = () => {
  useFetchActiveTopicDetail();
  const marker = useChatStore(
    (s) => topicSelectors.getTopicById(context.topicId)(s)?.metadata?.runningOperation,
  );
  useGatewayReconnect(context.topicId, marker, context.agentId);
  return useOperationState(context);
};

describe('background runs in the active topic', () => {
  beforeEach(() => {
    vi.spyOn(cacheScope, 'get').mockReturnValue('cr-test:personal');
    vi.spyOn(cacheScope, 'use').mockReturnValue('cr-test:personal');
    vi.spyOn(cacheScope, 'canHydrate').mockReturnValue(false);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    useChatStore.setState({
      activeAgentId: context.agentId,
      activeTopicId: context.topicId,
      activeGroupId: undefined,
      creatingTopicIds: [],
      operations: {},
      operationsByContext: {},
      operationsByMessage: {},
      operationsByType: {},
      topicDataMap: {},
      topicDetailMap: {},
      topicDetailReplica: createReplicaState(),
      topicListReplica: createReplicaState(),
    });
    useChatStore
      .getState()
      .internal_updateTopics(context.agentId, { items: [topic], pageSize: 20, total: 1 });
    config.serverConfig.agentGatewayUrl = 'wss://gateway.test';
    vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue(topic);
    // Network boundary: reconnect's local operation is what the real composer reads.
    vi.spyOn(useChatStore.getState(), 'reconnectToGatewayOperation').mockImplementation(
      async () => {
        useChatStore.getState().startOperation({ context, type: 'execServerAgentRuntime' });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('discovers a CR run while the conversation stays open and restores the stop control', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isInputVisiblyLoading).toBe(false);

    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      ...topic,
      metadata: { runningOperation },
      status: 'running',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.isInputVisiblyLoading).toBe(true);
    expect(
      topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.metadata?.runningOperation,
    ).toEqual(runningOperation);

    const reads = vi.mocked(topicService.getTopicDetail).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(topicService.getTopicDetail).toHaveBeenCalledTimes(reads);

    act(() => {
      for (const op of Object.values(useChatStore.getState().operations)) {
        useChatStore.getState().completeOperation(op.id);
      }
    });
    expect(result.current.isInputVisiblyLoading).toBe(false);
  });

  it('discovers another background run after the previous one ends', async () => {
    vi.useFakeTimers();
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      ...topic,
      metadata: { runningOperation },
    });
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isInputVisiblyLoading).toBe(true);

    vi.mocked(topicService.getTopicDetail).mockResolvedValue(topic);
    await act(async () => {
      useChatStore.getState().internal_dispatchTopic({
        id: topic.id,
        type: 'updateTopic',
        value: { metadata: { runningOperation: null } },
      });
      for (const op of Object.values(useChatStore.getState().operations)) {
        useChatStore.getState().completeOperation(op.id);
      }
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.isInputVisiblyLoading).toBe(false);

    const next = { ...runningOperation, operationId: 'server-cr-2' };
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      ...topic,
      metadata: { runningOperation: next },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.isInputVisiblyLoading).toBe(true);
    expect(useChatStore.getState().reconnectToGatewayOperation).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite a local run that starts while discovery is in flight', async () => {
    vi.useFakeTimers();
    let resolve!: (topic: ChatTopic) => void;
    vi.mocked(topicService.getTopicDetail).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      useChatStore.getState().startOperation({ context, type: 'sendMessage' });
    });
    await act(async () => {
      resolve({ ...topic, metadata: { runningOperation } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isInputVisiblyLoading).toBe(true);
    expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
    expect(
      topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.metadata?.runningOperation,
    ).toBeUndefined();
  });

  it('does not resurrect a run when a local send also finishes before the discovery response', async () => {
    vi.useFakeTimers();
    let resolve!: (topic: ChatTopic) => void;
    vi.mocked(topicService.getTopicDetail).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      const { operationId } = useChatStore
        .getState()
        .startOperation({ context, type: 'sendMessage' });
      useChatStore.getState().completeOperation(operationId);
    });
    await act(async () => {
      resolve({ ...topic, metadata: { runningOperation } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isInputVisiblyLoading).toBe(false);
    expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
  });

  it('does not poll known topics without a gateway', async () => {
    vi.useFakeTimers();
    config.serverConfig.agentGatewayUrl = '';
    renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(topicService.getTopicDetail).not.toHaveBeenCalled();
  });

  it('keeps the missing-topic detail fallback without a gateway', async () => {
    vi.useFakeTimers();
    config.serverConfig.agentGatewayUrl = '';
    useChatStore
      .getState()
      .internal_updateTopics(context.agentId, { items: [], pageSize: 20, total: 0 });
    renderHook(useFetchActiveTopicDetail, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(topicSelectors.getTopicById(topic.id)(useChatStore.getState())).toEqual(topic);
  });
});
