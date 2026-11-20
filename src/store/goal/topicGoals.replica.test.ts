/**
 * @vitest-environment happy-dom
 *
 * The goals a conversation created are a replica keyed by topic: a reload
 * paints the persisted rows before the network answers, their statuses only
 * count as current once the server confirms them, and the composer tray and
 * the working sidebar share one request.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { type GoalListItem, goalService } from '@/services/goal';

import { useGoalStore } from './index';
import { initialState } from './initialState';
import { goalListResource, topicGoalListResource } from './projection';
import { goalSelectors } from './selectors';

vi.mock('@/services/goal', () => ({
  goalService: {
    delete: vi.fn(),
    getGraph: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('@/services/metric', () => ({
  metricService: { listSeriesWithPoints: vi.fn() },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const goal = (id: string, status = 'running'): GoalListItem =>
  ({ goal: { id, status, title: id }, pendingDecisions: 0 }) as unknown as GoalListItem;

const listPage = (goals: GoalListItem[], total = goals.length) => ({ goals, total });

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const TOPIC = 'tpc-1';
const TOPIC_STORAGE_KEY = topicGoalListResource.storageKey(TOPIC);

const topicGoalIds = () =>
  goalSelectors
    .topicGoals(TOPIC)(useGoalStore.getState())
    ?.map((item) => item.goal.id);

const confirmed = () => goalSelectors.topicGoalsConfirmed(TOPIC)(useGoalStore.getState());

describe('topic goal replica', () => {
  const scopes = new Set<string>();
  const scopeRef = { current: '' };
  const useScope = (next: string) => {
    scopeRef.current = next;
    scopes.add(next);
  };

  const persist = (goals: GoalListItem[], scope = scopeRef.current) =>
    topicGoalListResource.storage!.set(
      { queryKey: TOPIC_STORAGE_KEY, scope },
      { data: listPage(goals), updatedAt: 1 },
    );

  const stored = async () =>
    (
      await topicGoalListResource.storage!.get({
        queryKey: TOPIC_STORAGE_KEY,
        scope: scopeRef.current,
      })
    )?.data;

  beforeEach(() => {
    useScope(`topic-goal-user-${randomUUID()}:personal`);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useGoalStore.setState(initialState));
  });

  afterEach(async () => {
    for (const scope of scopes) {
      await topicGoalListResource.storage!.remove({ queryKey: TOPIC_STORAGE_KEY, scope });
      await goalListResource.storage!.remove({
        queryKey: goalListResource.storageKey({ agentId: 'agent-1', filter: 'all' }),
        scope,
      });
    }
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted rows before the network answers, then takes the server’s', async () => {
    await persist([goal('cached')]);
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(goalService.list).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );

    renderHook(() => useGoalStore((s) => s.useFetchTopicGoals)(TOPIC), { wrapper });

    await waitFor(() => expect(topicGoalIds()).toEqual(['cached']));
    expect(goalService.list).toHaveBeenCalledWith({ limit: 20, topicId: TOPIC });

    await act(async () => {
      resolve(listPage([goal('fresh', 'achieved')]));
    });
    await waitFor(() => expect(topicGoalIds()).toEqual(['fresh']));
    await waitFor(async () => expect((await stored())?.goals[0].goal.id).toBe('fresh'));
  });

  it('treats the restored statuses as unconfirmed until the server answers', async () => {
    await persist([goal('cached', 'running')]);
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(goalService.list).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );

    renderHook(() => useGoalStore((s) => s.useFetchTopicGoals)(TOPIC), { wrapper });

    await waitFor(() => expect(topicGoalIds()).toEqual(['cached']));
    // A stored "running" is only what it was when persisted.
    expect(confirmed()).toBe(false);

    await act(async () => {
      resolve(listPage([goal('cached', 'achieved')]));
    });
    await waitFor(() => expect(confirmed()).toBe(true));
  });

  it('keeps the last rows when a background refresh fails', async () => {
    await persist([goal('cached')]);
    vi.mocked(goalService.list).mockRejectedValue(new Error('network down'));

    const sync = renderHook(() => useGoalStore((s) => s.useFetchTopicGoals)(TOPIC), { wrapper });

    await waitFor(() => expect(sync.result.current.error).toBeDefined());
    expect(topicGoalIds()).toEqual(['cached']);
  });

  it('sends one request for the composer tray and the sidebar together', async () => {
    vi.mocked(goalService.list).mockResolvedValue(listPage([goal('g1')]) as never);

    renderHook(
      () => {
        // The tray and the sidebar decide `generating` from different stores.
        useGoalStore((s) => s.useFetchTopicGoals)(TOPIC, false);
        useGoalStore((s) => s.useFetchTopicGoals)(TOPIC, undefined);
      },
      { wrapper },
    );

    await waitFor(() => expect(topicGoalIds()).toEqual(['g1']));
    expect(goalService.list).toHaveBeenCalledTimes(1);
  });

  it('never shows the previous identity’s rows after a scope switch', async () => {
    vi.mocked(goalService.list).mockResolvedValue(listPage([goal('mine')]) as never);
    const sync = renderHook(() => useGoalStore((s) => s.useFetchTopicGoals)(TOPIC), { wrapper });
    await waitFor(() => expect(topicGoalIds()).toEqual(['mine']));

    vi.mocked(goalService.list).mockImplementation(pending);
    useScope(`topic-goal-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(topicGoalIds()).toBeUndefined());
  });

  it('drops a deleted goal from the topic rows and their persisted copy', async () => {
    vi.mocked(goalService.list).mockResolvedValue(listPage([goal('g1'), goal('g2')]) as never);
    renderHook(() => useGoalStore((s) => s.useFetchTopicGoals)(TOPIC), { wrapper });
    await waitFor(() => expect(topicGoalIds()).toEqual(['g1', 'g2']));
    await waitFor(async () => expect((await stored())?.goals).toHaveLength(2));

    vi.mocked(goalService.delete).mockResolvedValue(undefined as never);
    vi.mocked(goalService.list).mockImplementation(pending);
    void useGoalStore.getState().deleteGoal('agent-1', 'g1');

    await waitFor(() => expect(topicGoalIds()).toEqual(['g2']));
    // A reload must not restore the deleted goal from storage.
    await waitFor(async () =>
      expect((await stored())?.goals.map((item) => item.goal.id)).toEqual(['g2']),
    );
  });
});
