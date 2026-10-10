import { GOAL_ACCEPTANCE_TASK_TITLE, type GoalStatus } from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalMetricCriterion, GoalTickResult } from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  revalidateReplica,
} from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { type GoalListItem, goalService } from '@/services/goal';
import { type MetricSeriesWithPoints, metricService } from '@/services/metric';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { goalStatusesForFilter } from './goalListFilter';
import { useGoalStore } from './index';
import type { GoalListFilter, GoalState, GoalViewMode } from './initialState';
import {
  GOAL_LIST_FILTERS,
  goalGraphResource,
  goalListEntity,
  goalListKey,
  type GoalListParams,
  goalListResource,
  goalListScopeParams,
  type GoalListValue,
  goalMetricSeriesResource,
  homeGoalListResource,
} from './projection';

/**
 * The goals page reads one wide page and reveals more of it client-side, so the
 * server read is a single window rather than a paged walk.
 */
const GOAL_LIST_FETCH_LIMIT = 100;

/**
 * The home roll-up only ever renders goals that are still open, so it asks for
 * the statuses one can be open in and leaves the terminal ones on the server.
 * `completed` is in because a completed goal is awaiting acceptance until the
 * user accepts it.
 *
 * The limit still bites in a workspace with more than this many such goals —
 * `groupList` takes the newest, and accepted goals stay `completed` — so the
 * tail of a very long history can crowd out an old still-running goal. Fixing
 * that for real needs an acceptance join on the server; this keeps the window
 * as wide as the query allows in the meantime.
 */
// The home roll-up only renders goals that are still open: terminal states
// (achieved / canceled) stay on the server, `review` is included because a
// converged goal is still awaiting the user's sign-off.
const HOME_GOAL_STATUSES: GoalStatus[] = ['planning', 'running', 'verifying', 'review'];
const HOME_GOAL_FETCH_LIMIT = 100;

/**
 * Statuses in which the *server* is the one making progress. A goal now
 * advances from server events, so nothing tells an open page to re-read: the
 * frontier, activity and findings would sit frozen — a spinner still turning
 * on a goal that already finished — until the tab lost and regained focus.
 *
 * `review` and `paused` are deliberately out: those wait on a person, and the
 * action that moves them refreshes the snapshot itself.
 */
const SERVER_ADVANCING_STATUSES = new Set<GoalStatus>(['planning', 'running', 'verifying']);

/** Kept coarse on purpose — this is liveness, not a progress bar. */
const GOAL_GRAPH_POLL_INTERVAL = 5000;
const PENDING_CLARIFICATIONS_POLL_INTERVAL = 30_000;

/**
 * Acceptance states in which the Goal's own delivery has nothing left in
 * flight. `pending`, `planned`, `repairing` and `verifying` are writes still on
 * their way from the coordinator or from the verify run it dispatched.
 *
 * `rejected` is terminal for this poll as well. Rejecting a Goal's delivery
 * either reopens the Goal — `reopenForChanges` makes it `running`, which the
 * advancing-status branch above already covers — or only records the decision
 * (`acceptance.reject` with `dispatch: false`), after which nothing else is
 * coming for that acceptance. Leaving it out polls that sticky state every five
 * seconds for as long as the page stays open.
 */
const SETTLED_ACCEPTANCE_STATUSES = new Set([
  'accepted',
  'closed',
  'delivered',
  'errored',
  'rejected',
]);

/**
 * Whether the Goal's own acceptance has a write still coming.
 *
 * A terminal Goal whose own acceptance has not settled is **mid-transition**:
 * the verdict is not written yet. Stopping the poll on that half-written
 * snapshot is what froze an open result page after a rework — the Goal already
 * read 已达成 while the sign-off strip still showed the rejected round and the
 * criteria count stayed at the rework's starting point, until the page was
 * reloaded. Keep reading until the acceptance settles; the settled snapshot is
 * the one the page can rest on.
 */
const goalAcceptanceUnsettled = (graph: GoalGraphSnapshot): boolean => {
  const terminal = graph.nodes?.find(
    (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE,
  );
  const acceptance = terminal ? graph.acceptances?.[terminal.id] : undefined;
  return !!acceptance && !SETTLED_ACCEPTANCE_STATUSES.has(acceptance.status);
};

/**
 * Whether an open graph still has a server-side write coming — the poll driver
 * for the graph snapshot itself.
 */
const goalGraphShouldPoll = (graph: GoalGraphSnapshot): boolean =>
  SERVER_ADVANCING_STATUSES.has(graph.goal.status) ||
  graph.report?.status === 'running' ||
  (graph.goal.status === 'achieved' && goalAcceptanceUnsettled(graph));

/**
 * Whether the *coordinator* is still moving — the poll driver for the north-star
 * series, which is only re-sampled while the goal is advancing.
 */
const goalCoordinatorAdvancing = (graph: GoalGraphSnapshot | undefined): boolean =>
  !!graph && SERVER_ADVANCING_STATUSES.has(graph.goal.status);

/**
 * Polling is driven from the store view, not from SWR's function-form
 * `refreshInterval`: a replica's sync hook is a plain number, and the goal
 * graph lands in the view after the first response, which re-renders this
 * subscription and arms the timer.
 */
const useGoalGraphAdvancing = (goalId?: string | null): boolean =>
  useGoalStore((state) => {
    const graph = goalId ? state.goalGraphById[goalId] : undefined;
    return graph ? goalGraphShouldPoll(graph) : false;
  });

const useGoalCoordinatorAdvancing = (goalId?: string | null): boolean =>
  useGoalStore((state) =>
    goalCoordinatorAdvancing(goalId ? state.goalGraphById[goalId] : undefined),
  );

/** A conversation rarely plans more than one goal; this only bounds a runaway topic. */
const TOPIC_GOAL_FETCH_LIMIT = 20;

const topicGoalsRefreshInterval = (
  result: { goals: { goal: { status: GoalStatus } }[] } | undefined,
  generating?: boolean,
) =>
  generating || result?.goals.some(({ goal }) => SERVER_ADVANCING_STATUSES.has(goal.status))
    ? GOAL_GRAPH_POLL_INTERVAL
    : 0;

export type GoalStore = GoalState & GoalAction;
type Setter = StoreSetter<GoalStore>;

export class GoalActionImpl {
  readonly #get: () => GoalStore;
  readonly #goalGraph;
  readonly #goalList;
  /** The list rows wherever they are held: the scope's tabs and the home rail. */
  readonly #goalListRows;
  readonly #goalMetricSeries;
  readonly #homeGoalList;
  readonly #set: Setter;

  constructor(set: Setter, get: () => GoalStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;

    this.#goalList = createReplicaSlice(goalListResource, {
      actionPrefix: 'goalList',
      entity: goalListEntity,
      fetcher: ({ agentId, filter, projectId }) =>
        goalService.list({
          agentId,
          limit: GOAL_LIST_FETCH_LIMIT,
          projectId,
          statuses: goalStatusesForFilter(filter),
        }),
      get,
      set,
      stateKey: 'goalListReplica',
      view: recordLens<GoalStore, GoalListValue>('goalListByAgentId'),
    });

    this.#homeGoalList = createReplicaSlice(homeGoalListResource, {
      actionPrefix: 'homeGoalList',
      entity: goalListEntity,
      fetcher: () =>
        goalService.list({ limit: HOME_GOAL_FETCH_LIMIT, statuses: HOME_GOAL_STATUSES }),
      get,
      set,
      stateKey: 'homeGoalsReplica',
      view: recordLens<GoalStore, GoalListValue>('homeGoalsByScope'),
    });

    // One goal row is rendered by a scope's tabs and by the home rail; a change
    // to it has to reach every list holding it, loaded or only persisted.
    this.#goalListRows = linkReplicaEntity<GoalListItem>([this.#goalList, this.#homeGoalList]);

    this.#goalGraph = createReplicaSlice(goalGraphResource, {
      actionPrefix: 'goalGraph',
      fetcher: (goalId) => goalService.getGraph(goalId),
      get,
      set,
      stateKey: 'goalGraphReplica',
      view: recordLens<GoalStore, GoalGraphSnapshot>('goalGraphById'),
    });

    this.#goalMetricSeries = createReplicaSlice(goalMetricSeriesResource, {
      actionPrefix: 'goalMetricSeries',
      // Only the declared keys are fetched — the same goal can accumulate any
      // number of other sampled series, and none of them can affect this view.
      // Keys are read at fetch time; the declare path revalidates this cache
      // key right after refreshing the graph, so a newly declared clause is
      // fetched against fresh criteria.
      fetcher: (goalId) =>
        metricService.listSeriesWithPoints(
          'goal',
          goalId,
          (this.#get().goalGraphById[goalId]?.goal.config?.acceptance?.metrics ?? []).map(
            (criterion) => criterion.key,
          ),
        ),
      get,
      set,
      stateKey: 'goalMetricSeriesReplica',
      view: recordLens<GoalStore, MetricSeriesWithPoints[]>('goalMetricSeriesById'),
    });
  }

  /**
   * `agentId` is absent for a goal with no responsible agent — one created from
   * a project page. There is no per-agent list to prune in that case, so only
   * the scoped refetch happens, against the list scope the caller was rendering
   * (`project:<id>` on a project page, the agent id otherwise).
   */
  deleteGoal = async (
    agentId: string | undefined,
    goalId: string,
    scopeId?: string,
  ): Promise<void> => {
    await goalService.delete(goalId);
    // Fan out across every list that holds the row — every tab of the scope the
    // caller was rendering, the home rail, and persisted rows of lists that are
    // not loaded: a list the user navigated away from must not repaint it.
    this.#goalListRows.remove(goalId);
    // The graph and the metric series are their own per-goal replicas: the
    // deleted id is never fetched again, so a persisted row left behind is an
    // orphan that only consumes local storage. Drop both with the lists.
    this.#goalGraph.remove(goalId);
    this.#goalMetricSeries.remove(goalId);
    const scope = scopeId ?? agentId;
    if (scope) await this.refreshGoals(scope);
  };

  /**
   * Resolve a pending decision gate. `goalId` is the `goals` row id.
   *
   * Resolving a gate does not advance the graph — the coordinator only moves on
   * the next tick — so the caller decides whether to follow up with `tickGoal`.
   */
  decideGoal = async (
    goalId: string,
    params: { decisionId: string; optionId: string; resolution?: string },
  ): Promise<void> => {
    await goalService.decide({ id: goalId, ...params });
    // The same gate is asked by the island, the inbox brief and the home goal
    // rail; answered in one place, every other one stops asking.
    await Promise.all([
      this.refreshGoalGraph(goalId),
      mutate(goalKeys.pendingForIsland()),
      revalidateReplica(homeGoalListResource),
      mutate((key) => Array.isArray(key) && key[0] === 'brief:list'),
    ]);
  };

  /** Answer a goal's clarification round in one call, then refresh every view of it. */
  answerGoalClarifications = async (
    goalId: string,
    answers: Array<{ decisionId: string; optionId: string; resolution?: string }>,
  ): Promise<void> => {
    await goalService.answerClarifications({ answers, id: goalId });
    await Promise.all([this.refreshGoalGraph(goalId), mutate(goalKeys.pendingClarifications())]);
  };

  pauseGoal = async (goalId: string): Promise<void> => {
    await goalService.pause(goalId);
    await this.refreshGoalGraph(goalId);
  };

  closeGoal = async (goalId: string, status: 'achieved' | 'canceled'): Promise<void> => {
    await goalService.close(goalId, status);
    await this.refreshGoalGraph(goalId);
  };

  refreshGoalGraph = async (goalId: string): Promise<void> => {
    await this.#goalGraph.revalidate(goalId);
  };

  resumeGoal = async (goalId: string): Promise<void> => {
    await goalService.resume(goalId);
    await this.refreshGoalGraph(goalId);
  };

  setGoalBudget = async (
    goalId: string,
    budget: {
      deadline?: string | null;
      maxRounds?: number | null;
      maxTotalCost?: number | null;
    },
  ): Promise<void> => {
    await goalService.setBudget({ id: goalId, ...budget });
    await this.refreshGoalGraph(goalId);
  };

  updateGoalRequirement = async (goalId: string, requirement: string): Promise<void> => {
    await goalService.updateRequirement(goalId, requirement);
    await this.refreshGoalGraph(goalId);
  };

  /**
   * Ask the server to run the coordinator now. The goal keeps advancing on its
   * own afterwards as its Work Tasks settle, so this is a nudge rather than the
   * loop the surface used to hold open.
   */
  advanceGoal = async (goalId: string): Promise<GoalTickResult> => {
    const result = await goalService.advance(goalId);
    await this.refreshGoalGraph(goalId);
    return result;
  };

  /** Exactly one coordinator step, for a caller that wants to inspect a single move. */
  tickGoal = async (goalId: string): Promise<GoalTickResult> => {
    const result = await goalService.tick(goalId);
    await this.refreshGoalGraph(goalId);
    return result;
  };

  /**
   * Clarifications waiting on the user across their goals — what the global
   * island asks when the user is not on that goal's page. A goal parks until
   * answered, so a slow poll plus focus revalidation is enough.
   */
  useFetchPendingClarifications = (enabled: boolean) =>
    useClientDataSWR(
      enabled ? goalKeys.pendingClarifications() : null,
      () => goalService.pendingClarifications(),
      { refreshInterval: PENDING_CLARIFICATIONS_POLL_INTERVAL, revalidateOnFocus: true },
    );

  /**
   * Gates and sign-offs waiting on the user across their goals — what the
   * island asks outside the goal page. Same cadence as the clarifications.
   */
  useFetchPendingForIsland = (enabled: boolean) =>
    useClientDataSWR(
      enabled ? goalKeys.pendingForIsland() : null,
      () => goalService.pendingForIsland(),
      { refreshInterval: PENDING_CLARIFICATIONS_POLL_INTERVAL, revalidateOnFocus: true },
    );

  /**
   * The Goal Graph snapshot behind the process-control surface. Read it through
   * `goalSelectors.goalGraph`, never from this hook — the replica owns the
   * value, the hook only orchestrates the fetch.
   */
  useFetchGoalGraph = (goalId?: string | null) => {
    const shouldPoll = useGoalGraphAdvancing(goalId);
    // Freshness while a graph is polling is the point; the first frame paints
    // the persisted snapshot, so nothing has to wait for the network.
    const sync = this.#goalGraph.useSync(goalId || null, {
      // A goal deleted by another client answers NOT_FOUND on every read, and a
      // cached snapshot is enough for the page to keep painting the gone goal —
      // and, while it still reads as advancing, to keep polling the missing
      // endpoint. NOT_FOUND is definitive, so drop the goal's cached rows (the
      // snapshot and its metric series) and let the page settle on its 404; any
      // transient failure keeps the persisted snapshot on screen.
      onError: (error) => {
        if (!goalId || !isTrpcErrorCode(error, 'NOT_FOUND')) return;
        this.#goalGraph.remove(goalId);
        this.#goalMetricSeries.remove(goalId);
      },
      refreshInterval: shouldPoll ? GOAL_GRAPH_POLL_INTERVAL : 0,
      revalidateOnFocus: true,
    });
    return { ...sync, isLoading: sync.isValidating, mutate: sync.revalidate };
  };

  /**
   * Goals created from one conversation. A goal a CLI agent creates through
   * `lh goal create --conversation` leaves no tool result to derive a card from,
   * so the conversation reads the link from the goal rows instead. Polls on the
   * graph's cadence while any of them is still advancing on the server, and
   * while a `/goal` request is generating (`generating`, decided by the caller)
   * — that run is the one that creates the goal, so nothing on screen would
   * otherwise ask for it.
   */
  useFetchTopicGoals = (topicId?: string | null, generating?: boolean) =>
    useClientDataSWR(
      topicId ? goalKeys.topicGoals(topicId) : null,
      () => goalService.list({ limit: TOPIC_GOAL_FETCH_LIMIT, topicId: topicId! }),
      {
        refreshInterval: (result) => topicGoalsRefreshInterval(result, generating),
        revalidateOnFocus: true,
      },
    );

  /**
   * North-star data of the goal detail header, read through
   * `goalSelectors.goalMetricSeries`. Polls on the same cadence logic as the
   * graph: while the server is advancing, a probe Work or an agent
   * `recordObservation` can land a fresh point at any time.
   */
  useFetchGoalMetricSeries = (goalId?: string | null) => {
    const shouldPoll = useGoalCoordinatorAdvancing(goalId);
    const sync = this.#goalMetricSeries.useSync(goalId || null, {
      refreshInterval: shouldPoll ? GOAL_GRAPH_POLL_INTERVAL : 0,
      revalidateOnFocus: true,
    });
    return { ...sync, isLoading: sync.isValidating, mutate: sync.revalidate };
  };

  refreshGoalMetricSeries = async (goalId: string): Promise<void> => {
    await this.#goalMetricSeries.revalidate(goalId);
  };

  /** Append one clause to the goal's measured acceptance and refresh both reads. */
  declareGoalMetric = async (goalId: string, criterion: GoalMetricCriterion): Promise<void> => {
    // Merged on the server against its current list — a replacement array
    // built from this client's snapshot would silently drop whatever a
    // concurrent editor or agent declared since the snapshot was read.
    await goalService.setMetricCriteria(goalId, [criterion], 'merge');
    await this.refreshGoalGraph(goalId);
    await this.refreshGoalMetricSeries(goalId);
  };

  /**
   * Record a measurement against the goal. The server schedules an advance
   * when the observation clears the gate, so the graph refresh may come back
   * already reopened.
   */
  recordGoalObservation = async (
    goalId: string,
    observation: { key: string; title?: string; value: number },
  ): Promise<void> => {
    await goalService.recordObservation(goalId, observation);
    await this.refreshGoalMetricSeries(goalId);
    await this.refreshGoalGraph(goalId);
  };

  loadMoreGoals = (): void => {
    this.#set(
      ({ goalListVisibleLimit }) => ({ goalListVisibleLimit: goalListVisibleLimit + 10 }),
      false,
      'loadMoreGoals',
    );
  };

  /** Re-read every tab of one scope's list (a create / delete moves any of them). */
  refreshGoals = async (scopeId: string): Promise<void> => {
    await Promise.all(
      GOAL_LIST_FILTERS.map((filter) =>
        this.#goalList.revalidate(goalListKey(goalListScopeParams(scopeId, filter))),
      ),
    );
  };

  refreshHomeGoals = async (scope: string): Promise<void> => {
    await this.#homeGoalList.revalidate(scope);
  };

  setGoalListFilter = (filter: GoalListFilter): void => {
    this.#set({ goalListFilter: filter, goalListVisibleLimit: 10 }, false, 'setGoalListFilter');
  };

  setGoalViewMode = (mode: GoalViewMode): void => {
    this.#set({ goalViewMode: mode }, false, 'setGoalViewMode');
  };

  /**
   * The goal list page's read, one entry per tab — read the rows through
   * `goalSelectors.goalListView` (`all`) or the tab's own entry key.
   *
   * A narrow tab asks the server for its own statuses rather than filtering the
   * `all` page on the client: the read only loads the newest `limit` goals, so a
   * client-side filter would let a busy agent's older matching goal fall past
   * the page and the tab would report itself empty while the goal exists.
   *
   * The persisted projection is what makes a revisit paint the rows before the
   * network answers, so the page never flashes its empty state over hydrated
   * data.
   */
  useFetchGoals = (agentId?: string, projectId?: string, filter: GoalListFilter = 'all') => {
    const params: GoalListParams | undefined =
      agentId || projectId ? { agentId, filter, projectId } : undefined;
    const key = params ? goalListKey(params) : undefined;
    const sync = this.#goalList.useSync(params ?? null, { revalidateOnFocus: true });

    return {
      ...sync,
      // A request in flight with nothing to show for this key yet — the store
      // view, not the network, decides whether there is something on screen.
      isLoading: sync.isValidating && !(key && this.#get().goalListByAgentId[key]),
      mutate: sync.revalidate,
    };
  };

  /**
   * Every agent's goals in one read — the home rail is a cross-agent roll-up,
   * so it cannot go through the per-agent list. Same server query minus the
   * assignee filter; the rail buckets and truncates client-side. Read the rows
   * through `goalSelectors.homeGoals(scope)`.
   */
  useFetchHomeGoals = (enabled: boolean, scope: string) => {
    const sync = this.#homeGoalList.useSync({ scope }, { enabled, revalidateOnFocus: true });
    return {
      ...sync,
      isLoading: sync.isValidating && !this.#get().homeGoalsByScope[scope],
      mutate: sync.revalidate,
    };
  };
}

export type GoalAction = Pick<GoalActionImpl, keyof GoalActionImpl>;
