import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { aiChatService } from '@/services/aiChat';
import { goalService } from '@/services/goal';

import { useGoalStore } from './index';
import { initialState } from './initialState';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'user-1:personal',
  isScopeTrusted: () => true,
  useCacheScope: () => 'user-1:personal',
}));

vi.mock('@/services/goal', () => ({
  goalService: {
    advance: vi.fn(),
    delete: vi.fn(),
    getGraph: vi.fn(),
    list: vi.fn(),
    tick: vi.fn(),
    updateTitle: vi.fn(),
  },
}));

vi.mock('@/services/aiChat', () => ({
  aiChatService: { generateJSON: vi.fn() },
}));

const SCOPE = 'user-1:personal';

/** The replica sync call of one resource — the hydrate read shares the hook. */
const syncCallFor = (name: string) =>
  vi
    .mocked(useClientDataSWR)
    .mock.calls.findLast(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    );

/** The sync key of one resource: `['replica:sync', name, version, scope, entryKey, params]`. */
const syncKeyFor = (name: string) => syncCallFor(name)?.[0] as unknown[] | undefined;

const syncConfigFor = (name: string) =>
  syncCallFor(name)?.[2] as { refreshInterval?: number } | undefined;

/** The fetch thunk the driver handed to SWR for that sync. */
const syncFetcherFor = (name: string) => syncCallFor(name)?.[1] as (() => unknown) | undefined;

const graphWith = (status: string, extra: Record<string, unknown> = {}) =>
  ({
    goal: { id: 'goal-1', status, title: 'Goal' },
    nodes: [],
    ...extra,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useClientDataSWR).mockReturnValue({
    data: undefined,
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  } as never);
  useGoalStore.setState(initialState);
});

describe('GoalAction', () => {
  describe('useFetchGoalGraph', () => {
    const renderGraph = (goalId = 'goal-1') =>
      renderHook(() => useGoalStore.getState().useFetchGoalGraph(goalId));

    const seedGraph = (graph: unknown) =>
      act(() =>
        useGoalStore.setState({ goalGraphById: graph ? { 'goal-1': graph as never } : {} }),
      );

    it.each(['planning', 'running', 'verifying'])(
      'keeps re-reading a %s goal the server is still advancing',
      (status) => {
        // The goal advances from server events now; without this the page would
        // sit on its first snapshot until the tab lost and regained focus.
        seedGraph(graphWith(status));
        renderGraph();

        expect(syncConfigFor('goalGraph')?.refreshInterval).toBeGreaterThan(0);
      },
    );

    /**
     * Regression: the agent starts its draft from the conversation a few seconds
     * after creating it. Unpolled, the card and page kept reading "Not started"
     * while its tasks ran.
     */
    it('keeps re-reading a draft its agent may start at any moment', () => {
      seedGraph(graphWith('draft'));
      renderGraph();

      expect(syncConfigFor('goalGraph')?.refreshInterval).toBeGreaterThan(0);
    });

    it.each(['review', 'paused', 'achieved', 'failed', 'canceled'])(
      'stops polling a %s goal',
      (status) => {
        // Nothing on the server will move these — the next change comes from a
        // person, and the action that makes it refreshes the snapshot itself.
        seedGraph(graphWith(status));
        renderGraph();

        expect(syncConfigFor('goalGraph')?.refreshInterval).toBe(0);
      },
    );

    it('keeps polling a finished goal while its wrap-up report is being written', () => {
      seedGraph(graphWith('achieved', { report: { status: 'running' } }));
      renderGraph();
      expect(syncConfigFor('goalGraph')?.refreshInterval).toBeGreaterThan(0);

      vi.mocked(useClientDataSWR).mockClear();
      seedGraph(graphWith('achieved', { report: { status: 'completed' } }));
      renderGraph();
      expect(syncConfigFor('goalGraph')?.refreshInterval).toBe(0);
    });

    it('does not poll before the first snapshot arrives', () => {
      renderGraph();

      expect(syncConfigFor('goalGraph')?.refreshInterval).toBe(0);
    });

    /**
     * Regression: a rework ends by putting the Goal back on `achieved`, but its
     * own acceptance verdict is a later write. The poll stopped on that
     * half-written snapshot, so an open result page stayed on the rework's
     * starting state — sign-off strip still reading 修改中, criteria count
     * frozen — until the page was reloaded.
     */
    it('keeps polling a terminal Goal whose own acceptance has not settled', () => {
      const withAcceptance = (status: string, title = GOAL_ACCEPTANCE_TASK_TITLE) =>
        graphWith('achieved', {
          acceptances: { 'node-a': { id: 'acc-1', status } },
          nodes: [{ id: 'node-a', kind: 'task', status: 'active', taskId: 't-1', title }],
        });

      for (const status of ['repairing', 'verifying']) {
        vi.mocked(useClientDataSWR).mockClear();
        seedGraph(withAcceptance(status));
        renderGraph();
        expect(syncConfigFor('goalGraph')?.refreshInterval).toBeGreaterThan(0);
      }

      // Settled: the page can rest on this snapshot.
      for (const status of ['delivered', 'accepted', 'rejected']) {
        vi.mocked(useClientDataSWR).mockClear();
        seedGraph(withAcceptance(status));
        renderGraph();
        expect(syncConfigFor('goalGraph')?.refreshInterval).toBe(0);
      }

      // A rejection that reopens the Goal keeps polling: the Goal is running again.
      vi.mocked(useClientDataSWR).mockClear();
      seedGraph({
        ...(withAcceptance('rejected') as Record<string, unknown>),
        goal: { id: 'goal-1', status: 'running', title: 'Goal' },
      });
      renderGraph();
      expect(syncConfigFor('goalGraph')?.refreshInterval).toBeGreaterThan(0);

      // Another task's rejection never keeps a terminal Goal polling.
      vi.mocked(useClientDataSWR).mockClear();
      seedGraph(withAcceptance('rejected', 'Ordinary work'));
      renderGraph();
      expect(syncConfigFor('goalGraph')?.refreshInterval).toBe(0);
    });
  });

  describe('useFetchGoalMetricSeries', () => {
    it('polls the series only while the coordinator is advancing', () => {
      act(() => useGoalStore.setState({ goalGraphById: { 'goal-1': graphWith('running') } }));
      renderHook(() => useGoalStore.getState().useFetchGoalMetricSeries('goal-1'));
      expect(syncConfigFor('goalMetricSeries')?.refreshInterval).toBeGreaterThan(0);

      vi.mocked(useClientDataSWR).mockClear();
      useGoalStore.setState({ goalGraphById: { 'goal-1': graphWith('review') } });
      renderHook(() => useGoalStore.getState().useFetchGoalMetricSeries('goal-1'));
      expect(syncConfigFor('goalMetricSeries')?.refreshInterval).toBe(0);
    });
  });

  describe('useFetchTopicGoals', () => {
    it('reads the goals created from the topic through the topic-keyed replica', () => {
      renderHook(() => useGoalStore.getState().useFetchTopicGoals('tpc-1'));
      const key = syncKeyFor('topicGoalList');

      expect(key?.[3]).toBe(SCOPE);
      expect(key?.[4]).toBe('tpc-1');
      void syncFetcherFor('topicGoalList')?.();
      expect(goalService.list).toHaveBeenCalledWith({ limit: 20, topicId: 'tpc-1' });
    });

    it('does not fetch without a topic', () => {
      renderHook(() => useGoalStore.getState().useFetchTopicGoals(undefined));

      expect(syncCallFor('topicGoalList')).toBeUndefined();
    });

    it('polls only while one of the goals is still advancing on the server', () => {
      const withStatuses = (...statuses: string[]) => {
        act(() =>
          useGoalStore.setState({
            topicGoalsByTopicId: {
              'tpc-1': {
                goals: statuses.map((status) => ({ goal: { status } })) as never,
                total: statuses.length,
              },
            },
          }),
        );
        renderHook(() => useGoalStore.getState().useFetchTopicGoals('tpc-1'));
        return syncConfigFor('topicGoalList')?.refreshInterval;
      };

      expect(withStatuses('achieved', 'running')).toBeGreaterThan(0);
      expect(withStatuses('review', 'paused')).toBe(0);
      // Regression: the tray read "Not started" after its agent started the draft.
      expect(withStatuses('draft')).toBeGreaterThan(0);
      act(() => useGoalStore.setState({ topicGoalsByTopicId: {} }));
      renderHook(() => useGoalStore.getState().useFetchTopicGoals('tpc-1'));
      expect(syncConfigFor('topicGoalList')?.refreshInterval).toBe(0);
    });

    it('polls while the conversation is generating, before any goal exists', () => {
      // A CLI agent's /goal run creates the goal mid-run: the first read finds
      // nothing, and without polling the tray stayed empty until a page reload.
      renderHook(() => useGoalStore.getState().useFetchTopicGoals('tpc-1', true));

      expect(syncConfigFor('topicGoalList')?.refreshInterval).toBeGreaterThan(0);
    });
  });

  describe('useFetchGoals', () => {
    it('reads an agent scope under the scope’s own entry, with every status', () => {
      renderHook(() => useGoalStore.getState().useFetchGoals('agent-1'));
      const key = syncKeyFor('goalList');

      expect(key?.[3]).toBe(SCOPE);
      expect(key?.[4]).toBe('agent-1');
      void syncFetcherFor('goalList')?.();
      expect(goalService.list).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', limit: 100 }),
      );
    });

    it('uses the complete goal workspace with a project-scoped query and entry', () => {
      renderHook(() => useGoalStore.getState().useFetchGoals(undefined, 'project-1'));

      expect(syncKeyFor('goalList')?.[4]).toBe('project:project-1');
      void syncFetcherFor('goalList')?.();
      expect(goalService.list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1' }),
      );
    });

    it('reads the cross-agent list without an assignee filter, keyed by cache scope', () => {
      renderHook(() =>
        useGoalStore.getState().useFetchGoals(undefined, undefined, 'all', 'user-1:workspace-1'),
      );

      expect(syncKeyFor('goalList')?.[4]).toBe('global:user-1:workspace-1');
      void syncFetcherFor('goalList')?.();
      const [query] = vi.mocked(goalService.list).mock.calls[0];
      expect(query).toMatchObject({ limit: 100 });
      expect(query?.agentId).toBeUndefined();
      expect(query?.projectId).toBeUndefined();
    });

    it('asks the server for the tab’s own statuses under the tab’s own entry', () => {
      // A page of the newest goals cannot answer "what is in review", so the tab
      // gets its own server read rather than a client-side filter.
      renderHook(() => useGoalStore.getState().useFetchGoals('agent-1', undefined, 'review'));

      expect(syncKeyFor('goalList')?.[4]).toBe('agent-1:goals-page:review');
      void syncFetcherFor('goalList')?.();
      expect(goalService.list).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', statuses: ['review'] }),
      );
    });

    it('does not fetch without a scope', () => {
      const sync = renderHook(() => useGoalStore.getState().useFetchGoals());

      expect(syncCallFor('goalList')).toBeUndefined();
      expect(sync.result.current.isLoading).toBe(false);
    });

    it('reports loading only while nothing is on screen for the entry', () => {
      vi.mocked(useClientDataSWR).mockReturnValue({
        data: undefined,
        error: undefined,
        isValidating: true,
        mutate: vi.fn(),
      } as never);

      const sync = renderHook(() => useGoalStore.getState().useFetchGoals('agent-1'));
      expect(sync.result.current.isLoading).toBe(true);

      // A hydrated row is on screen, so an in-flight revalidation is not a
      // reason to hide it behind a skeleton.
      act(() =>
        useGoalStore.setState({
          goalListByAgentId: { 'agent-1': { goals: [], total: 0 } },
        }),
      );
      sync.rerender();
      expect(sync.result.current.isLoading).toBe(false);
    });
  });

  describe('useFetchHomeGoals', () => {
    it('keys the roll-up by cache scope and asks only for the open statuses', () => {
      renderHook(() => useGoalStore.getState().useFetchHomeGoals(true, 'user:ws-a'));

      expect(syncKeyFor('homeGoalList')?.[4]).toBe('user:ws-a');
      void syncFetcherFor('homeGoalList')?.();
      expect(goalService.list).toHaveBeenCalledWith(
        expect.objectContaining({ statuses: ['planning', 'running', 'verifying', 'review'] }),
      );
      expect(goalService.list).toHaveBeenCalledWith(
        expect.not.objectContaining({
          statuses: expect.arrayContaining(['paused', 'failed', 'achieved', 'canceled']),
        }),
      );
    });
  });

  it('revalidates every tab of the requested scope, and no other scope', async () => {
    await useGoalStore.getState().refreshGoals('agent-1');

    const matches = vi
      .mocked(mutate)
      .mock.calls.map(([match]) => match as (key: unknown) => boolean);
    const isMatched = (entryKey: string) =>
      matches.some((match) =>
        match(['replica:sync', 'goalList', 1, SCOPE, entryKey, {}] as unknown),
      );

    expect(isMatched('agent-1')).toBe(true);
    expect(isMatched('agent-1:goals-page:review')).toBe(true);
    expect(isMatched('agent-1:goals-page:running')).toBe(true);
    expect(isMatched('agent-1:goals-page:achieved')).toBe(true);
    expect(isMatched('agent-2')).toBe(false);
  });

  it('owns list display state', () => {
    useGoalStore.getState().setGoalListFilter('all');
    useGoalStore.getState().setGoalViewMode('card');
    useGoalStore.getState().loadMoreGoals();

    expect(useGoalStore.getState()).toMatchObject({
      goalListFilter: 'all',
      goalListVisibleLimit: 20,
      goalViewMode: 'card',
    });
  });

  it('deletes a goal through the goal endpoint and drops it from the loaded list', async () => {
    useGoalStore.setState({
      goalListByAgentId: {
        'agent-1': {
          goals: [{ goal: { id: 'goal-1' } }, { goal: { id: 'goal-2' } }] as never,
          total: 2,
        },
      },
    });

    await useGoalStore.getState().deleteGoal('agent-1', 'goal-1');

    expect(goalService.delete).toHaveBeenCalledWith('goal-1');
    const list = useGoalStore.getState().goalListByAgentId['agent-1'];
    expect(list?.goals.map((item) => item.goal.id)).toEqual(['goal-2']);
    expect(list?.total).toBe(1);
  });

  it('relays the provider the goal actually plans on when advancing it', async () => {
    vi.mocked(goalService.advance).mockResolvedValue({ ticks: 1 } as never);
    vi.mocked(goalService.tick).mockResolvedValue({} as never);
    useGoalStore.setState({
      goalGraphById: {
        'goal-1': graphWith('running', {
          goal: {
            config: { model: 'local-llm', provider: 'ollama' },
            id: 'goal-1',
            status: 'running',
            title: 'Goal',
          },
        }),
      },
    });

    await useGoalStore.getState().advanceGoal('goal-1');
    await useGoalStore.getState().tickGoal('goal-1');

    expect(goalService.advance).toHaveBeenCalledWith('goal-1', 'ollama');
    expect(goalService.tick).toHaveBeenCalledWith('goal-1', 'ollama');
  });

  describe('goal title', () => {
    const LONG_ASK = '继续并完成桌宠项目，在现有基础上完善 TTS 语音系统，补齐唤醒词与打断';

    const seedEverywhere = () =>
      useGoalStore.setState({
        goalGraphById: {
          'goal-1': graphWith('paused', {
            goal: { id: 'goal-1', requirement: LONG_ASK, status: 'paused', title: LONG_ASK },
            nodes: [
              { id: 'n1', kind: 'task', status: 'active', title: 'Wire up the TTS engine' },
              { id: 'n2', kind: 'finding', status: 'resolved', title: 'Edge TTS has low latency' },
            ],
          }),
        },
        goalListByAgentId: {
          'agent-1': { goals: [{ goal: { id: 'goal-1', title: LONG_ASK } }] as never, total: 1 },
        },
        homeGoalsByScope: {
          [SCOPE]: { goals: [{ goal: { id: 'goal-1', title: LONG_ASK } }] as never, total: 1 },
        },
      });

    const titlesShown = () => {
      const state = useGoalStore.getState();
      return [
        state.goalGraphById['goal-1']?.goal.title,
        state.goalListByAgentId['agent-1']?.goals[0]?.goal.title,
        state.homeGoalsByScope[SCOPE]?.goals[0]?.goal.title,
      ];
    };

    it('renames the goal on the page and in every list holding it', async () => {
      seedEverywhere();
      vi.mocked(goalService.updateTitle).mockResolvedValue({} as never);

      await useGoalStore.getState().updateGoalTitle('goal-1', '  桌宠 TTS  ');

      expect(goalService.updateTitle).toHaveBeenCalledWith('goal-1', '桌宠 TTS');
      expect(titlesShown()).toEqual(['桌宠 TTS', '桌宠 TTS', '桌宠 TTS']);
    });

    it('ignores a blank title', async () => {
      seedEverywhere();

      await useGoalStore.getState().updateGoalTitle('goal-1', '   ');

      expect(goalService.updateTitle).not.toHaveBeenCalled();
      expect(titlesShown()).toEqual([LONG_ASK, LONG_ASK, LONG_ASK]);
    });

    it('re-reads from the server and rethrows when the rename is rejected', async () => {
      seedEverywhere();
      const error = new Error('forbidden');
      vi.mocked(goalService.updateTitle).mockRejectedValue(error);

      await expect(useGoalStore.getState().updateGoalTitle('goal-1', 'New')).rejects.toBe(error);

      expect(mutate).toHaveBeenCalled();
    });

    it('names the goal from its ask and progress with the topic title chain', async () => {
      seedEverywhere();
      vi.mocked(aiChatService.generateJSON).mockResolvedValue({
        data: { title: '桌宠 TTS 语音系统' },
      } as never);
      vi.mocked(goalService.updateTitle).mockResolvedValue({} as never);

      await useGoalStore.getState().autoRenameGoalTitle('goal-1');

      const [params] = vi.mocked(aiChatService.generateJSON).mock.calls[0];
      const prompt = (params as { messages: Array<{ content: string }> }).messages
        .map((message) => message.content)
        .join('\n');
      expect(prompt).toContain(LONG_ASK);
      expect(prompt).toContain('Wire up the TTS engine');
      expect(prompt).toContain('Edge TTS has low latency');
      expect(params).toMatchObject({ schema: { name: expect.any(String) } });
      expect(goalService.updateTitle).toHaveBeenCalledWith('goal-1', '桌宠 TTS 语音系统');
      expect(titlesShown()).toEqual([
        '桌宠 TTS 语音系统',
        '桌宠 TTS 语音系统',
        '桌宠 TTS 语音系统',
      ]);
      expect(useGoalStore.getState().goalTitleRenamingIds).toEqual([]);
    });

    it('keeps the title and reports the failure when no title comes back', async () => {
      seedEverywhere();
      vi.mocked(aiChatService.generateJSON).mockResolvedValue({ data: { title: ' ' } } as never);

      await expect(useGoalStore.getState().autoRenameGoalTitle('goal-1')).rejects.toThrow();

      expect(goalService.updateTitle).not.toHaveBeenCalled();
      expect(titlesShown()).toEqual([LONG_ASK, LONG_ASK, LONG_ASK]);
      expect(useGoalStore.getState().goalTitleRenamingIds).toEqual([]);
    });

    it('reads the graph first when the goal is only known from a list', async () => {
      vi.mocked(goalService.getGraph).mockResolvedValue(
        graphWith('running', { goal: { id: 'goal-1', requirement: LONG_ASK, title: 'x' } }),
      );
      vi.mocked(aiChatService.generateJSON).mockResolvedValue({ data: { title: 'TTS' } } as never);
      vi.mocked(goalService.updateTitle).mockResolvedValue({} as never);

      await useGoalStore.getState().autoRenameGoalTitle('goal-1');

      expect(goalService.getGraph).toHaveBeenCalledWith('goal-1');
      expect(goalService.updateTitle).toHaveBeenCalledWith('goal-1', 'TTS');
    });
  });
});
