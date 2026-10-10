/**
 * @vitest-environment happy-dom
 *
 * The goal domain is a set of replicas now: the lists, the graph snapshot and
 * the metric series paint from their persisted copy on the first frame, the
 * network only confirms, deleting a goal fans out across every list that holds
 * it, and a scope switch never shows the previous identity's rows.
 */
import { randomUUID } from 'node:crypto';

import type { GoalGraphSnapshot } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { type GoalListItem, goalService } from '@/services/goal';
import { metricService } from '@/services/metric';

import { useGoalStore } from './index';
import { initialState } from './initialState';
import {
  goalGraphResource,
  goalListResource,
  goalMetricSeriesResource,
  homeGoalListResource,
} from './projection';

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

const graph = (id: string, status = 'running'): GoalGraphSnapshot =>
  ({ goal: { id, status, title: id }, nodes: [] }) as unknown as GoalGraphSnapshot;

const listPage = (goals: GoalListItem[], total = goals.length) => ({ goals, total });

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const AGENT_KEY = 'agent-1';
const REVIEW_KEY = `${AGENT_KEY}:goals-page:review`;
const ALL_STORAGE_KEY = goalListResource.storageKey({ agentId: AGENT_KEY, filter: 'all' });
const REVIEW_STORAGE_KEY = goalListResource.storageKey({ agentId: AGENT_KEY, filter: 'review' });
const GRAPH_STORAGE_KEY = goalGraphResource.storageKey('goal-1');
const SERIES_STORAGE_KEY = goalMetricSeriesResource.storageKey('goal-1');
const GRAPH_G1_STORAGE_KEY = goalGraphResource.storageKey('g1');
const SERIES_G1_STORAGE_KEY = goalMetricSeriesResource.storageKey('g1');
const HOME_SCOPE = 'home-scope';
const HOME_STORAGE_KEY = homeGoalListResource.storageKey({ scope: HOME_SCOPE });

const ALL_QUERY_KEYS = [
  ALL_STORAGE_KEY,
  REVIEW_STORAGE_KEY,
  GRAPH_STORAGE_KEY,
  SERIES_STORAGE_KEY,
  GRAPH_G1_STORAGE_KEY,
  SERIES_G1_STORAGE_KEY,
  HOME_STORAGE_KEY,
];

describe('goal store replicas', () => {
  const scopes = new Set<string>();
  const scopeRef = { current: '' };
  const useScope = (next: string) => {
    scopeRef.current = next;
    scopes.add(next);
  };

  beforeEach(() => {
    useScope(`goal-user-${randomUUID()}:personal`);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useGoalStore.setState(initialState));
  });

  afterEach(async () => {
    for (const value of scopes) {
      for (const queryKey of ALL_QUERY_KEYS) {
        for (const resource of [
          goalListResource,
          goalGraphResource,
          goalMetricSeriesResource,
          homeGoalListResource,
        ]) {
          await resource.storage!.remove({ queryKey, scope: value });
        }
      }
    }
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await goalListResource.storage!.set(
      { queryKey: ALL_STORAGE_KEY, scope: scopeRef.current },
      { data: listPage([goal('cached')], 7), updatedAt: 1 },
    );
    vi.mocked(goalService.list).mockImplementation(pending);

    const sync = renderHook(() => useGoalStore((s) => s.useFetchGoals)(AGENT_KEY), { wrapper });
    const list = renderHook(() => useGoalStore((s) => s.goalListByAgentId[AGENT_KEY]));

    await waitFor(() => expect(list.result.current?.goals[0].goal.id).toBe('cached'));
    // The total is the server's whole-set count, restored with the page.
    expect(list.result.current?.total).toBe(7);
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(goalService.list).mockResolvedValue(listPage([goal('server')], 1) as never);

    renderHook(() => useGoalStore((s) => s.useFetchGoals)(AGENT_KEY), { wrapper });

    await waitFor(() =>
      expect(useGoalStore.getState().goalListByAgentId[AGENT_KEY]?.goals[0].goal.id).toBe('server'),
    );
    await waitFor(async () =>
      expect(
        (
          await goalListResource.storage!.get({
            queryKey: ALL_STORAGE_KEY,
            scope: scopeRef.current,
          })
        )?.data,
      ).toEqual(listPage([goal('server')], 1)),
    );
  });

  it('keeps each tab its own entry, so a narrow tab never resets the window', async () => {
    vi.mocked(goalService.list).mockImplementation((async (params: { statuses?: string[] }) =>
      listPage([goal(params.statuses?.length === 1 ? 'review-only' : 'window')], 1)) as never);

    renderHook(
      () => {
        useGoalStore((s) => s.useFetchGoals)(AGENT_KEY);
        useGoalStore((s) => s.useFetchGoals)(AGENT_KEY, undefined, 'review');
      },
      { wrapper },
    );

    await waitFor(() =>
      expect(useGoalStore.getState().goalListByAgentId[AGENT_KEY]?.goals[0].goal.id).toBe('window'),
    );
    await waitFor(() =>
      expect(useGoalStore.getState().goalListByAgentId[REVIEW_KEY]?.goals[0].goal.id).toBe(
        'review-only',
      ),
    );
  });

  it('paints the persisted graph snapshot before the network answers', async () => {
    await goalGraphResource.storage!.set(
      { queryKey: GRAPH_STORAGE_KEY, scope: scopeRef.current },
      { data: graph('goal-1'), updatedAt: 1 },
    );
    vi.mocked(goalService.getGraph).mockImplementation(pending);

    const sync = renderHook(() => useGoalStore((s) => s.useFetchGoalGraph)('goal-1'), { wrapper });
    const snapshot = renderHook(() => useGoalStore((s) => s.goalGraphById['goal-1']));

    await waitFor(() => expect(snapshot.result.current?.goal.id).toBe('goal-1'));
    expect(sync.result.current.isHydrated).toBe(true);
  });

  it('paints the persisted metric series before the network answers', async () => {
    const series = [{ key: 'stars', points: [{ value: 1 }] }];
    await goalMetricSeriesResource.storage!.set(
      { queryKey: SERIES_STORAGE_KEY, scope: scopeRef.current },
      { data: series as never, updatedAt: 1 },
    );
    vi.mocked(metricService.listSeriesWithPoints).mockImplementation(pending);

    renderHook(() => useGoalStore((s) => s.useFetchGoalMetricSeries)('goal-1'), { wrapper });
    const view = renderHook(() => useGoalStore((s) => s.goalMetricSeriesById['goal-1']));

    await waitFor(() => expect(view.result.current).toEqual(series));
  });

  it('evicts a goal deleted elsewhere: a NOT_FOUND graph read drops the snapshot and its series', async () => {
    let rejectGraph: (error: unknown) => void = () => {};
    vi.mocked(goalService.getGraph).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectGraph = reject;
      }) as never,
    );
    vi.mocked(metricService.listSeriesWithPoints).mockImplementation(pending);

    await goalGraphResource.storage!.set(
      { queryKey: GRAPH_G1_STORAGE_KEY, scope: scopeRef.current },
      { data: graph('g1'), updatedAt: 1 },
    );
    await goalMetricSeriesResource.storage!.set(
      { queryKey: SERIES_G1_STORAGE_KEY, scope: scopeRef.current },
      { data: [{ key: 'stars', points: [{ value: 1 }] }] as never, updatedAt: 1 },
    );

    renderHook(() => useGoalStore((s) => s.useFetchGoalGraph)('g1'), { wrapper });
    const view = renderHook(() => useGoalStore((s) => s.goalGraphById.g1));

    // The first frame is the persisted snapshot of the now-deleted goal...
    await waitFor(() => expect(view.result.current?.goal.id).toBe('g1'));

    // ...and the deleted-elsewhere answer is definitive, so it is evicted.
    await act(async () => {
      rejectGraph({ data: { code: 'NOT_FOUND' } });
    });

    await waitFor(() => expect(useGoalStore.getState().goalGraphById.g1).toBeUndefined());
    await waitFor(() => expect(useGoalStore.getState().goalMetricSeriesById.g1).toBeUndefined());
    await waitFor(async () =>
      expect(
        await goalGraphResource.storage!.get({
          queryKey: GRAPH_G1_STORAGE_KEY,
          scope: scopeRef.current,
        }),
      ).toBeUndefined(),
    );
  });

  it('keeps the persisted snapshot when the graph read fails transiently', async () => {
    let rejectGraph: (error: unknown) => void = () => {};
    vi.mocked(goalService.getGraph).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectGraph = reject;
      }) as never,
    );
    vi.mocked(metricService.listSeriesWithPoints).mockImplementation(pending);

    await goalGraphResource.storage!.set(
      { queryKey: GRAPH_G1_STORAGE_KEY, scope: scopeRef.current },
      { data: graph('g1'), updatedAt: 1 },
    );

    renderHook(() => useGoalStore((s) => s.useFetchGoalGraph)('g1'), { wrapper });
    const view = renderHook(() => useGoalStore((s) => s.goalGraphById.g1));
    await waitFor(() => expect(view.result.current?.goal.id).toBe('g1'));

    await act(async () => {
      rejectGraph(new Error('network down'));
    });
    // A transient failure is not a delete: the persisted snapshot stays.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useGoalStore.getState().goalGraphById.g1).toBeDefined();
  });

  it('paints the home roll-up from storage, scoped to the workspace it belongs to', async () => {
    await homeGoalListResource.storage!.set(
      { queryKey: HOME_STORAGE_KEY, scope: scopeRef.current },
      { data: listPage([goal('home-goal')], 1), updatedAt: 1 },
    );
    vi.mocked(goalService.list).mockImplementation(pending);

    renderHook(() => useGoalStore((s) => s.useFetchHomeGoals)(true, HOME_SCOPE), { wrapper });
    const view = renderHook(() => useGoalStore((s) => s.homeGoalsByScope[HOME_SCOPE]));

    await waitFor(() => expect(view.result.current?.goals[0].goal.id).toBe('home-goal'));
  });

  it('drops the previous identity’s rows before the next one paints', async () => {
    vi.mocked(goalService.list).mockResolvedValue(listPage([goal('mine')], 1) as never);
    const sync = renderHook(() => useGoalStore((s) => s.useFetchGoals)(AGENT_KEY), { wrapper });
    await waitFor(() => expect(useGoalStore.getState().goalListByAgentId[AGENT_KEY]).toBeDefined());

    vi.mocked(goalService.list).mockImplementation(pending);
    useScope(`goal-user-${randomUUID()}:personal`);
    sync.rerender();

    // Nothing from the previous identity stays on screen while the new scope's
    // (empty) storage read is still in flight.
    await waitFor(() =>
      expect(useGoalStore.getState().goalListByAgentId[AGENT_KEY]).toBeUndefined(),
    );
  });

  describe('deleteGoal', () => {
    const seed = async () => {
      vi.mocked(goalService.list).mockResolvedValue(listPage([goal('g1'), goal('g2')], 2) as never);
      vi.mocked(goalService.getGraph).mockResolvedValue(graph('g1') as never);
      vi.mocked(metricService.listSeriesWithPoints).mockResolvedValue([
        { key: 'stars', points: [{ value: 1 }] },
      ] as never);
      renderHook(
        () => {
          useGoalStore((s) => s.useFetchGoals)(AGENT_KEY);
          useGoalStore((s) => s.useFetchGoals)(AGENT_KEY, undefined, 'review');
          useGoalStore((s) => s.useFetchHomeGoals)(true, HOME_SCOPE);
          useGoalStore((s) => s.useFetchGoalGraph)('g1');
          useGoalStore((s) => s.useFetchGoalMetricSeries)('g1');
        },
        { wrapper },
      );
      await waitFor(() => {
        expect(useGoalStore.getState().goalListByAgentId[AGENT_KEY]?.goals).toHaveLength(2);
        expect(useGoalStore.getState().homeGoalsByScope[HOME_SCOPE]?.goals).toHaveLength(2);
        expect(useGoalStore.getState().goalGraphById.g1).toBeDefined();
        expect(useGoalStore.getState().goalMetricSeriesById.g1).toBeDefined();
      });
    };

    it('removes the goal from every loaded list, the home roll-up, its graph and its metric series', async () => {
      await seed();
      vi.mocked(goalService.delete).mockResolvedValue(undefined as never);
      // Keep the follow-up list refresh in flight: the fan-out has to stand on
      // its own, and a landed refresh would answer for it instead.
      vi.mocked(goalService.list).mockImplementation(pending);

      const deletion = useGoalStore.getState().deleteGoal(AGENT_KEY, 'g1');

      await waitFor(() => {
        expect(useGoalStore.getState().goalGraphById.g1).toBeUndefined();
        expect(useGoalStore.getState().goalMetricSeriesById.g1).toBeUndefined();
        expect(
          useGoalStore.getState().homeGoalsByScope[HOME_SCOPE]?.goals.map((item) => item.goal.id),
        ).toEqual(['g2']);
      });

      const all = useGoalStore.getState().goalListByAgentId[AGENT_KEY];
      expect(all?.goals.map((item) => item.goal.id)).toEqual(['g2']);
      expect(all?.total).toBe(1);
      expect(
        useGoalStore.getState().goalListByAgentId[REVIEW_KEY]?.goals.map((item) => item.goal.id),
      ).toEqual(['g2']);
      // The deleted id is never fetched again, so its persisted per-goal rows
      // must not be left orphaned in IndexedDB.
      await waitFor(async () =>
        expect(
          await goalMetricSeriesResource.storage!.get({
            queryKey: SERIES_G1_STORAGE_KEY,
            scope: scopeRef.current,
          }),
        ).toBeUndefined(),
      );
      await waitFor(async () =>
        expect(
          await goalGraphResource.storage!.get({
            queryKey: GRAPH_G1_STORAGE_KEY,
            scope: scopeRef.current,
          }),
        ).toBeUndefined(),
      );
      expect(goalService.delete).toHaveBeenCalledWith('g1');
      void deletion;
    });
  });
});
