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

import { resetInterventionSnapshotSupport } from './transcript';

vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      getInterventionSnapshot: vi.fn(),
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
    resetInterventionSnapshotSupport();
    // A failing probe: every tick re-reads the page.
    vi.mocked(messageService.getInterventionSnapshot).mockRejectedValue(new Error('timeout'));
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
    // Regression: an unanswered card can stay `pending` for days, and an open
    // tab re-read the whole transcript every 2s for as long as it stayed open.
    const view = await mountPolling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_FAST_POLL_WINDOW + 8 * 60_000);
    });
    const requests = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    const perHalfHour = vi.mocked(messageService.getMessages).mock.calls.length - requests;
    // At the ceiling: one read every five minutes instead of one every 2s.
    expect(perHalfHour).toBeLessThanOrEqual(7);
    expect(perHalfHour).toBeGreaterThanOrEqual(5);
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

const snapshot = (status: 'approved' | 'pending', revision = 'r1') => ({
  revision,
  statuses: { question: status } as Record<string, 'approved' | 'pending'>,
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
    resetInterventionSnapshotSupport();
    vi.mocked(messageService.getInterventionSnapshot).mockResolvedValue(snapshot('pending'));
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
    // The first probe of the chain re-reads once to set its baseline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL * 2);
    });
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBe(reads);
    expect(messageService.getInterventionSnapshot).toHaveBeenCalledWith(context.topicId, [
      'question',
    ]);
    expect(
      vi.mocked(messageService.getInterventionSnapshot).mock.calls.length,
    ).toBeGreaterThanOrEqual(28);
    view.unmount();
  });

  it('re-reads the page once another device answered the card', async () => {
    const view = await mount();
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    vi.mocked(messageService.getInterventionSnapshot).mockResolvedValue(snapshot('approved'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBeGreaterThan(reads);
    view.unmount();
  });

  // Regression: the first probe only recorded its revision, so an argument
  // edit landing between the page read and that probe was never shown.
  it('re-reads the page on the first probe of a chain', async () => {
    const view = await mount();
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    vi.mocked(messageService.getInterventionSnapshot).mockResolvedValue(snapshot('pending', 'r2'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL + 100);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBeGreaterThan(reads);
    view.unmount();
  });

  it('re-reads the page when the topic changed while the card stays pending', async () => {
    const view = await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL * 2);
    });
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    // Another device edited the card's arguments or added a row.
    vi.mocked(messageService.getInterventionSnapshot).mockResolvedValue(snapshot('pending', 'r2'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL);
    });
    expect(vi.mocked(messageService.getMessages).mock.calls.length).toBeGreaterThan(reads);
    view.unmount();
  });

  it('stops asking a server that has no snapshot probe', async () => {
    vi.mocked(messageService.getInterventionSnapshot).mockRejectedValue(
      new Error('No procedure found on path "message.getInterventionSnapshot"'),
    );
    const view = await mount();
    const reads = vi.mocked(messageService.getMessages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(messageService.getInterventionSnapshot).toHaveBeenCalledTimes(1);
    // Falls back to re-reading the page, as before the probe existed.
    expect(vi.mocked(messageService.getMessages).mock.calls.length - reads).toBeGreaterThanOrEqual(
      8,
    );
    view.unmount();
  });

  it('polls a newly raised card at once instead of waiting out the backoff', async () => {
    const view = await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVENTION_FAST_POLL_WINDOW + 4 * 60_000);
    });
    // Sitting in a backed-off wait; the run raises a second card over the stream.
    const second = { ...pending, id: 'question-2', tool_call_id: 'call-2' };
    const probes = vi.mocked(messageService.getInterventionSnapshot).mock.calls.length;
    await act(async () => {
      useChatStore.setState({ dbMessagesMap: { [key]: [pending, second] } });
      await vi.advanceTimersByTimeAsync(INTERVENTION_REFRESH_INTERVAL + 100);
    });
    expect(vi.mocked(messageService.getInterventionSnapshot).mock.calls.length).toBeGreaterThan(
      probes,
    );
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
