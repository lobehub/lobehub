import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import {
  backoffPollInterval,
  hasPendingInterventions,
  INTERVENTION_FAST_POLL_WINDOW,
  INTERVENTION_MAX_REFRESH_INTERVAL,
  INTERVENTION_REFRESH_INTERVAL,
} from '@/store/chat/utils/interventionSync';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      getInterventionStatuses: vi.fn(),
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
/** A conversation whose loaded transcript holds one unanswered approval. */
const seedPending = () =>
  useChatStore.setState({
    dbMessagesMap: { [key]: [pending] },
    messagePagingMap: {},
    messageReplica: createReplicaState(),
    messagesMap: {},
  });

/**
 * Separate file: a card that stays pending keeps its key in the transcript's
 * module-level pending set, which would leak into the other polling tests.
 */
describe('pending approval poll backoff', () => {
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
    // A server without the status endpoint: every tick re-reads the page.
    vi.mocked(messageService.getInterventionStatuses).mockRejectedValue(new Error('NOT_FOUND'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mountPolling = async () => {
    seedPending();
    const cache = new Map();
    const view = renderHook(
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
    return view;
  };

  it('backs off a card that stays pending past the fast window', async () => {
    // Regression: a card whose run died stays `pending` in the database, and an
    // open tab re-read the whole transcript every 2s for as long as it stayed open.
    const view = await mountPolling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_FAST_POLL_WINDOW + 4 * 60_000);
    });
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    const perTenMinutes = vi.mocked(messageService.getMessages).mock.calls.length - requests;
    // 30s ceiling: about 20 reads in ten minutes instead of 300.
    expect(perTenMinutes).toBeLessThanOrEqual(21);
    expect(perTenMinutes).toBeGreaterThanOrEqual(19);
    view.unmount();
  });

  it('keeps the base interval within the fast window', async () => {
    const view = await mountPolling();
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      vi.mocked(messageService.getMessages).mock.calls.length - requests,
    ).toBeGreaterThanOrEqual(28);
    view.unmount();
  });

  it('restores the base interval when another card is raised', async () => {
    const view = await mountPolling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_FAST_POLL_WINDOW + 4 * 60_000);
    });
    // The first card was answered and the run raised the next one.
    const next = { ...pending, id: 'question-2', tool_call_id: 'call-2' };
    vi.mocked(messageService.getMessages).mockResolvedValue([next]);
    await act(async () => {
      useChatStore.setState({ dbMessagesMap: { [key]: [next] } });
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      vi.mocked(messageService.getMessages).mock.calls.length - requests,
    ).toBeGreaterThanOrEqual(28);
    view.unmount();
  });
});

describe('pending approval status poll', () => {
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
    vi.mocked(messageService.getInterventionStatuses).mockResolvedValue({ question: 'pending' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mount = async () => {
    seedPending();
    const cache = new Map();
    const view = renderHook(
      () => useChatStore.getState().useFetchMessages(context, { syncInterventions: true }),
      {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(SWRConfig, { value: { provider: () => cache } }, children),
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  };

  // Regression: each tick re-read the whole message page, megabytes for a long
  // topic, only to learn the card was still pending.
  it('asks only for the card status while it stays pending', async () => {
    const view = await mount();
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBe(reads);
    expect(messageService.getInterventionStatuses).toHaveBeenCalledWith(context.topicId, [
      'question',
    ]);
    expect(
      vi.mocked(messageService.getInterventionStatuses).mock.calls.length,
    ).toBeGreaterThanOrEqual(28);
    view.unmount();
  });

  it('re-reads the page once another device answered the card', async () => {
    const view = await mount();
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    vi.mocked(messageService.getInterventionStatuses).mockResolvedValue({ question: 'approved' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBeGreaterThan(reads);
    view.unmount();
  });
});

describe('backoffPollInterval', () => {
  it('keeps the base interval inside the fast window, then doubles each minute up to the ceiling', () => {
    const base = INTERVENTION_REFRESH_INTERVAL;
    expect(backoffPollInterval(base, 0)).toBe(base);
    expect(backoffPollInterval(base, INTERVENTION_FAST_POLL_WINDOW - 1)).toBe(base);
    expect(backoffPollInterval(base, INTERVENTION_FAST_POLL_WINDOW)).toBe(base * 2);
    expect(backoffPollInterval(base, INTERVENTION_FAST_POLL_WINDOW + 60_000)).toBe(base * 4);
    expect(backoffPollInterval(base, INTERVENTION_FAST_POLL_WINDOW + 60 * 60_000)).toBe(
      INTERVENTION_MAX_REFRESH_INTERVAL,
    );
    expect(backoffPollInterval(0, INTERVENTION_FAST_POLL_WINDOW * 10)).toBe(0);
  });
});
