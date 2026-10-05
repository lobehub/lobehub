import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import {
  hasPendingInterventions,
  INTERVENTION_REFRESH_INTERVAL,
} from '@/store/chat/utils/interventionSync';

import { createStore } from '../../index';

vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      getMessages,
      getMessageListPage: vi.fn(async (params: unknown) => ({
        messages: await getMessages(params),
        olderCursor: null,
      })),
    },
  };
});
vi.mock('@/services/topic', () => ({ topicService: { getTopicDetail: vi.fn() } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

const context = { agentId: 'sync-agent', threadId: null, topicId: 'sync-topic' };
const pending: UIChatMessage = {
  content: '',
  createdAt: 1,
  id: 'question',
  role: 'tool',
  tool_call_id: 'call-1',
  updatedAt: 10,
  pluginIntervention: { status: 'pending' },
};

describe('pending approval message polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMessageListClientCacheState();
    useChatStore.setState({ topicDataMap: {}, topicDetailMap: {} });
    vi.mocked(messageService.getMessages).mockResolvedValue([pending]);
    vi.mocked(messageService.getMessageListPage).mockImplementation(async (params) => ({
      messages: await messageService.getMessages(params),
      olderCursor: null,
    }));
    vi.mocked(topicService.getTopicDetail).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mountPolling = async () => {
    const store = createStore({ context });
    store.setState({ dbMessages: [pending] });
    const cache = new Map();
    renderHook(
      () => {
        const hasPending = store((state) => hasPendingInterventions(state.dbMessages));
        store.getState().useFetchMessages(context, {
          refreshInterval: hasPending ? INTERVENTION_REFRESH_INTERVAL : 0,
          syncInterventions: true,
        });
      },
      {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(SWRConfig, { value: { provider: () => cache } }, children),
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    return store;
  };

  it('keeps loaded history and its exhausted cursor after the final approval refresh', async () => {
    vi.mocked(messageService.getMessageListPage).mockImplementation(async () => ({
      messages: await messageService.getMessages(context),
      olderCursor: { createdAt: new Date(1).toISOString(), id: pending.id },
    }));
    const store = await mountPolling();
    const older: UIChatMessage = {
      id: 'older',
      role: 'user',
      content: 'Earlier round',
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(messageService.getEarlierMessages).mockResolvedValue({
      messages: [older],
      olderCursor: null,
    });
    await act(async () => {
      await store.getState().loadEarlierMessages();
    });
    expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['older', 'question']);
    const answered = { ...pending, pluginIntervention: { status: 'approved' as const } };
    const reply: UIChatMessage = {
      id: 'reply',
      role: 'assistant',
      content: 'Final reply',
      createdAt: 20,
      updatedAt: 20,
    };
    vi.mocked(messageService.getMessages).mockResolvedValue([answered, reply]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.getState().dbMessages).toEqual([older, answered, reply]);
    expect(store.getState().messagePaging?.hasMore).toBe(false);
    expect(messageService.getMessageListPage).toHaveBeenCalledTimes(3);
  });

  it('waits for a startup reservation and publishes the new operation for the existing reconnect hook', async () => {
    const store = await mountPolling();
    const answered = { ...pending, pluginIntervention: { status: 'approved' as const } };
    vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: context.topicId,
      status: 'active',
      metadata: {
        taskCallbackReservation: { messageId: 'resume', reservedAt: new Date().toISOString() },
      },
    } as Awaited<ReturnType<typeof topicService.getTopicDetail>>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.getState().dbMessages[0].pluginIntervention?.status).toBe('approved');
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBeGreaterThan(requests);
    const runningOperation = { assistantMessageId: 'reply', operationId: 'new-run' };
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: context.topicId,
      status: 'running',
      metadata: { runningOperation },
    } as Awaited<ReturnType<typeof topicService.getTopicDetail>>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(
      topicSelectors.getTopicById(context.topicId)(useChatStore.getState())?.metadata
        ?.runningOperation,
    ).toEqual(runningOperation);
  });

  it('reads final messages after the decision and topic, even with a stale local streaming flag', async () => {
    vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
    const store = await mountPolling();
    const order: string[] = [];
    const answered = { ...pending, pluginIntervention: { status: 'approved' as const } };
    vi.mocked(messageService.getMessages).mockImplementation(async () => {
      order.push('messages');
      return order.includes('topic')
        ? [
            answered,
            {
              id: 'reply',
              role: 'assistant',
              content: 'Final reply',
              createdAt: 20,
              updatedAt: 20,
            },
          ]
        : [answered];
    });
    vi.mocked(topicService.getTopicDetail).mockImplementation(async () => {
      order.push('topic');
      return null;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(order).toEqual(['messages', 'topic', 'messages']);
    expect(store.getState().dbMessages.at(-1)?.content).toBe('Final reply');
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
  });

  it('follows a slow remote continuation after the Ask closes without focus or remount', async () => {
    const store = createStore({ context });
    store.setState({ dbMessages: [pending] });
    const cache = new Map();
    renderHook(
      () => {
        const hasPending = store((state) => hasPendingInterventions(state.dbMessages));
        store.getState().useFetchMessages(context, {
          refreshInterval: hasPending ? INTERVENTION_REFRESH_INTERVAL : 0,
          syncInterventions: true,
        });
      },
      {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(SWRConfig, { value: { provider: () => cache } }, children),
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    const answered = { ...pending, pluginIntervention: { status: 'approved' as const } };
    vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: context.topicId,
      status: 'running',
      metadata: { runningOperation: { assistantMessageId: 'reply', operationId: 'continuation' } },
    } as Awaited<ReturnType<typeof topicService.getTopicDetail>>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.getState().dbMessages[0].pluginIntervention?.status).toBe('approved');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    vi.mocked(topicService.getTopicDetail).mockResolvedValue(null);
    vi.mocked(messageService.getMessages).mockResolvedValue([
      answered,
      {
        id: 'reply',
        role: 'assistant',
        content: 'Late continuation',
        createdAt: 20,
        updatedAt: 20,
      },
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.getState().dbMessages.at(-1)?.content).toBe('Late continuation');
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
  });

  it.each(['approved', 'rejected', 'aborted'] as const)(
    'updates the mounted peer on remote %s, then stops polling',
    async (status) => {
      const store = createStore({ context });
      store.setState({ dbMessages: [pending] });
      const usePollingMessages = () => {
        const hasPending = store((state) => hasPendingInterventions(state.dbMessages));
        const result = store((state) => state.dbMessages[0]?.pluginIntervention?.status);
        store.getState().useFetchMessages(context, {
          refreshInterval: hasPending ? INTERVENTION_REFRESH_INTERVAL : 0,
          syncInterventions: true,
        });
        return result;
      };
      const cache = new Map();
      const { result } = renderHook(usePollingMessages, {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(SWRConfig, { value: { provider: () => cache } }, children),
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current).toBe('pending');
      const answered: UIChatMessage = {
        ...pending,
        updatedAt: 1,
        content: 'Remote answer',
        pluginIntervention: { status },
      };
      vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current).toBe(status);
      expect(store.getState().dbMessages).toEqual([answered]);
      const requests = vi.mocked(messageService.getMessages).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
    },
  );
});
