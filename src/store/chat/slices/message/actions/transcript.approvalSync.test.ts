import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';
import { conversationMessagesKey } from '@/services/message/replica';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import {
  hasPendingInterventions,
  INTERVENTION_REFRESH_INTERVAL,
} from '@/store/chat/utils/interventionSync';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

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

const key = messageMapKey(context);
const rows = () => useChatStore.getState().dbMessagesMap[key] ?? [];
/** A conversation whose loaded transcript holds one unanswered approval. */
const seedPending = () =>
  useChatStore.setState({
    dbMessagesMap: { [key]: [pending] },
    messagePagingMap: {},
    messageReplica: createReplicaState(),
    messagesMap: {},
  });

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
    seedPending();
    const cache = new Map();
    renderHook(
      () => {
        const hasPending = useChatStore((state) =>
          hasPendingInterventions(state.dbMessagesMap[key] ?? []),
        );
        useChatStore.getState().useFetchMessages(context, {
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
  };

  it('keeps loaded history and its exhausted cursor after the final approval refresh', async () => {
    vi.mocked(messageService.getMessageListPage).mockImplementation(async () => ({
      messages: await messageService.getMessages(context),
      olderCursor: { createdAt: new Date(1).toISOString(), id: pending.id },
    }));
    await mountPolling();
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
      await useChatStore.getState().loadEarlierMessages(context);
    });
    expect(rows().map((m) => m.id)).toEqual(['older', 'question']);
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
    expect(rows()).toEqual([older, answered, reply]);
    expect(
      useChatStore.getState().messagePagingMap[conversationMessagesKey(context)]?.hasMore,
    ).toBe(false);
    expect(messageService.getMessageListPage).toHaveBeenCalledTimes(3);
  });

  it('waits for a startup reservation and publishes the new operation for the existing reconnect hook', async () => {
    await mountPolling();
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
    expect(rows()[0].pluginIntervention?.status).toBe('approved');
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
    await mountPolling();
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
    expect(rows().at(-1)?.content).toBe('Final reply');
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
  });

  it('binds a tool row the poll appends during a continuation to its stale local assistant', async () => {
    // Regression: after an Ask is answered the poll keeps running for the whole
    // continuation. A poll that is ahead of the stream appended the new tool row
    // while keeping the local, still-empty continuation assistant, so the tool
    // rendered as an orphan (and the next assistant as a detached turn) until a
    // page refresh.
    await mountPolling();
    const ask = {
      apiName: 'askUserQuestion',
      arguments: '{}',
      id: 'call-1',
      identifier: 'lobe-agent',
      type: 'builtin',
    };
    const activate = {
      apiName: 'activateTools',
      arguments: '{}',
      id: 'call-2',
      identifier: 'lobe-activator',
      type: 'builtin',
    };
    const owner: UIChatMessage = {
      content: 'Which one?',
      createdAt: 0,
      id: 'owner',
      role: 'assistant',
      tools: [ask],
      updatedAt: 0,
    } as UIChatMessage;
    const answered: UIChatMessage = {
      ...pending,
      parentId: 'owner',
      plugin: ask,
      pluginIntervention: { status: 'approved' },
    } as UIChatMessage;
    const continuation: UIChatMessage = {
      content: '',
      createdAt: 2,
      id: 'continuation',
      parentId: 'question',
      role: 'assistant',
      updatedAt: 2,
    };
    const activated: UIChatMessage = {
      content: 'ok',
      createdAt: 3,
      id: 'activated',
      parentId: 'continuation',
      plugin: activate,
      role: 'tool',
      tool_call_id: 'call-2',
      updatedAt: 3,
    } as UIChatMessage;
    const next: UIChatMessage = {
      content: '',
      createdAt: 4,
      id: 'next',
      parentId: 'activated',
      role: 'assistant',
      updatedAt: 4,
    };
    await act(async () => {
      useChatStore.getState().replaceMessages([owner, answered, continuation], { context });
    });

    vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
    vi.mocked(topicService.getTopicDetail).mockResolvedValue({
      id: context.topicId,
      status: 'running',
      metadata: { runningOperation: { assistantMessageId: 'continuation', operationId: 'resume' } },
    } as Awaited<ReturnType<typeof topicService.getTopicDetail>>);
    vi.mocked(messageService.getMessages).mockResolvedValue([
      owner,
      answered,
      { ...continuation, tools: [activate], updatedAt: 3 } as UIChatMessage,
      activated,
      next,
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(rows().map((m) => m.id)).toEqual([
      'owner',
      'question',
      'continuation',
      'activated',
      'next',
    ]);
    expect(
      rows()
        .find((m) => m.id === 'continuation')
        ?.tools?.map((t) => t.id),
    ).toEqual(['call-2']);
    expect(useChatStore.getState().messagesMap[key].map((m) => m.role)).toEqual(['assistantGroup']);
  });

  it('follows a slow remote continuation after the Ask closes without focus or remount', async () => {
    seedPending();
    const cache = new Map();
    renderHook(
      () => {
        const hasPending = useChatStore((state) =>
          hasPendingInterventions(state.dbMessagesMap[key] ?? []),
        );
        useChatStore.getState().useFetchMessages(context, {
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
    expect(rows()[0].pluginIntervention?.status).toBe('approved');
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
    expect(rows().at(-1)?.content).toBe('Late continuation');
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
  });

  it.each(['approved', 'rejected', 'aborted'] as const)(
    'updates the mounted peer on remote %s, then stops polling',
    async (status) => {
      seedPending();
      const usePollingMessages = () => {
        const hasPending = useChatStore((state) =>
          hasPendingInterventions(state.dbMessagesMap[key] ?? []),
        );
        const result = useChatStore(
          (state) => state.dbMessagesMap[key]?.[0]?.pluginIntervention?.status,
        );
        useChatStore.getState().useFetchMessages(context, {
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
      expect(rows()).toEqual([answered]);
      const requests = vi.mocked(messageService.getMessages).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(messageService.getMessages).toHaveBeenCalledTimes(requests);
    },
  );

  it('polls a card a stream delivered after the first read, within the poll interval', async () => {
    // Regression: the topic's first read ran under the 30s list dedupe window.
    // A card that arrived over the stream afterwards switched the sync to the
    // 2s poll, but every tick was deduped against that first read, so another
    // device's answer only showed up ~30s later.
    useChatStore.setState({
      dbMessagesMap: {},
      messagePagingMap: {},
      messageReplica: createReplicaState(),
      messagesMap: {},
    });
    vi.mocked(messageService.getMessages).mockResolvedValue([]);
    const cache = new Map();
    renderHook(
      () => {
        const hasPending = useChatStore((state) =>
          hasPendingInterventions(state.dbMessagesMap[key] ?? []),
        );
        useChatStore.getState().useFetchMessages(context, {
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
    expect(messageService.getMessages).toHaveBeenCalledTimes(1);

    // The run parks on a question: the card arrives over the stream, and the
    // server still reports it pending for a while.
    vi.mocked(messageService.getMessages).mockResolvedValue([pending]);
    await act(async () => {
      useChatStore.getState().replaceMessages([pending], { context });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL + 500);
    });

    // Another device answers; the next poll picks it up.
    const answered = { ...pending, pluginIntervention: { status: 'approved' as const } };
    vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * INTERVENTION_REFRESH_INTERVAL + 500);
    });

    expect(rows()[0].pluginIntervention?.status).toBe('approved');
  });
});
