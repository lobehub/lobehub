import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { scmService } from '@/services/scm';
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
    vi.spyOn(scmService, 'hasWakeTarget').mockResolvedValue(true);
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

  it.each(['empty bucket', 'listed row'])(
    'recovers a live run on cold entry with %s and stale detail',
    async (source) => {
      vi.useFakeTimers();
      vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
      useChatStore.setState({
        topicDataMap: source === 'empty bucket' ? {} : useChatStore.getState().topicDataMap,
        topicDetailMap: { [topic.id]: topic },
      });
      const marker = { ...runningOperation, heteroType: null, scope: 'main', threadId: null };
      vi.mocked(topicService.getTopicDetail).mockResolvedValue({
        ...topic,
        metadata: { runningOperation: marker },
        status: 'running',
      });
      const { result } = renderHook(useConversation, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.metadata?.runningOperation,
      ).toEqual(marker);
      expect(result.current.isInputVisiblyLoading).toBe(true);
      const reads = vi.mocked(topicService.getTopicDetail).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(topicService.getTopicDetail).toHaveBeenCalledTimes(reads);
    },
  );

  it.each(['topic edit', 'detail edit', 'list hydration'])(
    'applies a fresh live marker after %s overtakes the detail read',
    async (change) => {
      vi.useFakeTimers();
      let resolve!: (topic: ChatTopic) => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      if (change !== 'topic edit')
        useChatStore.setState({ topicDataMap: {}, topicDetailMap: { [topic.id]: topic } });
      const { result } = renderHook(useConversation, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        if (change === 'list hydration') {
          useChatStore.getState().internal_updateTopics(context.agentId, {
            items: [{ ...topic, title: 'Updated', status: 'running' }],
            pageSize: 20,
            total: 1,
          });
        } else {
          useChatStore.getState().internal_dispatchTopic({
            id: topic.id,
            type: 'updateTopic',
            value: { title: 'Updated', status: 'running' },
          });
        }
      });
      const marker = { ...runningOperation, heteroType: null, scope: 'main', threadId: null };
      await act(async () => {
        resolve({ ...topic, metadata: { runningOperation: marker }, status: 'running' });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.metadata?.runningOperation,
      ).toEqual(marker);
      expect(result.current.isInputVisiblyLoading).toBe(true);
      expect(topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.title).toBe('Updated');
    },
  );

  it.each(['deleted topic', 'edited topic without a live response'])(
    'does not revive stale details after %s',
    async (change) => {
      vi.useFakeTimers();
      let resolve!: (value: ChatTopic) => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      renderHook(useFetchActiveTopicDetail, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        if (change === 'deleted topic') {
          useChatStore.getState().internal_dispatchTopic({ id: topic.id, type: 'deleteTopic' });
        } else {
          useChatStore.getState().internal_dispatchTopic({
            id: topic.id,
            type: 'updateTopic',
            value: { title: 'Updated', status: 'completed' },
          });
        }
      });
      await act(async () => {
        resolve(change === 'deleted topic' ? { ...topic, metadata: { runningOperation } } : topic);
        await vi.advanceTimersByTimeAsync(0);
      });
      const current = topicSelectors.getTopicById(topic.id)(useChatStore.getState());
      if (change === 'deleted topic') expect(current).toBeUndefined();
      else expect(current).toMatchObject({ title: 'Updated', status: 'completed' });
      expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
    },
  );

  it.each(['stop marker', 'replacement marker'])(
    'rejects a live response overtaken by a %s',
    async (change) => {
      vi.useFakeTimers();
      let resolve!: (topic: ChatTopic) => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      renderHook(useFetchActiveTopicDetail, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const newerMarker =
        change === 'stop marker' ? null : { ...runningOperation, operationId: 'newer-run' };
      act(() => {
        useChatStore.getState().internal_dispatchTopic({
          id: topic.id,
          type: 'updateTopic',
          value: { metadata: { runningOperation: newerMarker } },
        });
      });
      await act(async () => {
        resolve({ ...topic, metadata: { runningOperation } });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.metadata?.runningOperation,
      ).toEqual(newerMarker);
      expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'waits for topic creation before reading a missing topic (gateway %s)',
    async (gateway) => {
      vi.useFakeTimers();
      config.serverConfig.agentGatewayUrl = gateway ? 'wss://gateway.test' : '';
      useChatStore.setState({ topicDataMap: {}, creatingTopicIds: [topic.id] });
      vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
      renderHook(useFetchActiveTopicDetail, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(topicService.getTopicDetail).not.toHaveBeenCalled();
      act(() => {
        useChatStore.setState({ creatingTopicIds: [] });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(topicService.getTopicDetail).toHaveBeenCalledTimes(1);
      expect(topicSelectors.getTopicById(topic.id)(useChatStore.getState())).toEqual(topic);
    },
  );

  it.each(['missing', 'error'])(
    'keeps cached running status when a cold detail read is %s',
    async (response) => {
      vi.useFakeTimers();
      const cached = { ...topic, status: 'running' as const };
      useChatStore.setState({ topicDataMap: {}, topicDetailMap: { [topic.id]: cached } });
      vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
      if (response === 'missing') vi.mocked(topicService.getTopicDetail).mockResolvedValue(null);
      else
        vi.mocked(topicService.getTopicDetail).mockRejectedValue(new Error('detail unavailable'));
      const { result } = renderHook(useConversation, { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(topicSelectors.getTopicById(topic.id)(useChatStore.getState())).toEqual(cached);
      expect(result.current.isInputVisiblyLoading).toBe(false);
      expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
    },
  );

  it('does not create a local run for a completed topic on cold entry', async () => {
    vi.useFakeTimers();
    useChatStore.setState({ topicDataMap: {}, topicDetailMap: { [topic.id]: topic } });
    vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      ...topic,
      status: 'completed',
      metadata: { runningOperation: null },
    });
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(topicSelectors.getTopicById(topic.id)(useChatStore.getState())?.status).toBe(
      'completed',
    );
    expect(result.current.isInputVisiblyLoading).toBe(false);
    expect(useChatStore.getState().reconnectToGatewayOperation).not.toHaveBeenCalled();
    expect(topicService.getTopicDetail).toHaveBeenCalledTimes(1);
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
      await vi.advanceTimersByTimeAsync(15_000);
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
      await vi.advanceTimersByTimeAsync(15_000);
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

  it('does not poll a known topic that no review or CI event can wake', async () => {
    vi.useFakeTimers();
    vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
    renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(scmService.hasWakeTarget).toHaveBeenCalledWith(context.topicId);
    // One entry read checks for an existing run; no SCM target means no polling.
    expect(topicService.getTopicDetail).toHaveBeenCalledTimes(1);
  });

  it('starts watching once a local run links the topic to a pull request', async () => {
    vi.useFakeTimers();
    vi.mocked(scmService.hasWakeTarget).mockResolvedValue(false);
    const { result } = renderHook(useConversation, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The agent opens a pull request during this run.
    let operationId!: string;
    act(() => {
      ({ operationId } = useChatStore.getState().startOperation({ context, type: 'sendMessage' }));
    });
    vi.mocked(scmService.hasWakeTarget).mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      useChatStore.getState().completeOperation(operationId);
      // SWR revalidates a cached key on the next animation frame.
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(scmService.hasWakeTarget).toHaveBeenCalledTimes(2);
    expect(topicService.getTopicDetail).toHaveBeenCalled();

    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      ...topic,
      metadata: { runningOperation },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.isInputVisiblyLoading).toBe(true);
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
