import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_TITLE_MAX_LENGTH,
  type GoalStatus,
} from '@lobechat/const/goal';
import {
  chainSummaryTitle,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '@lobechat/prompts';
import {
  type GoalGraphSnapshot,
  type GoalMetricCriterion,
  type GoalTickResult,
  RequestTrigger,
} from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  revalidateReplica,
} from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { aiChatService } from '@/services/aiChat';
import { type GoalListItem, goalService } from '@/services/goal';
import { type MetricSeriesWithPoints, metricService } from '@/services/metric';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { goalStatusesForFilter } from './goalListFilter';
import { buildGoalTitleMessages } from './goalTitle';
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
  topicGoalListResource,
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

/**
 * Whether an open view must keep re-reading a goal in this status. A draft is
 * arranged and usually started by its agent from the conversation, never from
 * this view, so no local action would refresh its "Not started".
 */
const goalStatusPolled = (status: GoalStatus) =>
  SERVER_ADVANCING_STATUSES.has(status) || status === 'draft';

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
  goalStatusPolled(graph.goal.status) ||
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

/**
 * The composer tray and the working sidebar both read a topic's goals on
 * mount; this window collapses them into one request. It stays under the poll
 * interval because SWR's poll ticks dedupe too.
 */
const TOPIC_GOALS_DEDUPING_INTERVAL = 4000;

const useTopicGoalsAdvancing = (topicId?: string | null): boolean =>
  useGoalStore((state) =>
    topicId
      ? (state.topicGoalsByTopicId[topicId]?.goals.some(({ goal }) =>
          goalStatusPolled(goal.status),
        ) ?? false)
      : false,
  );

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
  readonly #topicGoalList;

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

    this.#topicGoalList = createReplicaSlice(topicGoalListResource, {
      actionPrefix: 'topicGoalList',
      entity: goalListEntity,
      fetcher: (topicId) => goalService.list({ limit: TOPIC_GOAL_FETCH_LIMIT, topicId }),
      get,
      set,
      stateKey: 'topicGoalsReplica',
      view: recordLens<GoalStore, GoalListValue>('topicGoalsByTopicId'),
    });

    // One goal row is rendered by a scope's tabs, the home rail and the
    // conversation that created it; a change to it has to reach every list
    // holding it, loaded or only persisted.
    this.#goalListRows = linkReplicaEntity<GoalListItem>([
      this.#goalList,
      this.#homeGoalList,
      this.#topicGoalList,
    ]);

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

  startGoal = async (goalId: string): Promise<void> => {
    await goalService.start(goalId);
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

  /**
   * The goal moves to the new agent's goal list, so both agents' lists re-read
   * along with the page.
   */
  setGoalAgent = async (goalId: string, agentId: string): Promise<void> => {
    await goalService.setAgent(goalId, agentId);
    await Promise.all([
      this.refreshGoalGraph(goalId),
      revalidateReplica(goalListResource),
      revalidateReplica(homeGoalListResource),
    ]);
  };

  /** Unfinished Tasks move with the executor, so their rows on the page re-read too. */
  setGoalTaskAgent = async (goalId: string, agentId: string | null): Promise<void> => {
    await goalService.setTaskAgent(goalId, agentId);
    await this.refreshGoalGraph(goalId);
  };

  setGoalModel = async (
    goalId: string,
    modelConfig: { model: string; provider: string } | null,
  ): Promise<void> => {
    await goalService.setModel(goalId, modelConfig);
    await this.refreshGoalGraph(goalId);
  };

  /** Unfinished Tasks switch model with it, so their rows re-read too. */
  setGoalTaskModel = async (
    goalId: string,
    modelConfig: { model: string; provider: string } | null,
  ): Promise<void> => {
    await goalService.setTaskModel(goalId, modelConfig);
    await this.refreshGoalGraph(goalId);
  };

  updateGoalRequirement = async (goalId: string, requirement: string): Promise<void> => {
    await goalService.updateRequirement(goalId, requirement);
    await this.refreshGoalGraph(goalId);
  };

  /** Each goal's latest title write, so writes reach the server in the order they were made. */
  #titleWrites = new Map<string, Promise<unknown>>();

  /**
   * Rename a goal everywhere it is shown — the page header, every list tab,
   * the home rail and the conversation that created it — before the server
   * answers. A rejected rename re-reads them all from the server and rethrows,
   * so the caller can say why. Writes run one at a time per goal, so the latest
   * edit is the one the server keeps, whichever request would have finished first.
   */
  updateGoalTitle = async (goalId: string, title: string): Promise<void> => {
    const next = title.trim().slice(0, GOAL_TITLE_MAX_LENGTH);
    if (!next) return;

    this.#goalGraph.update(
      goalId,
      (graph) =>
        graph && {
          ...graph,
          goal: { ...graph.goal, title: next },
          // The server moves the root question along while it still has the old title.
          nodes: graph.nodes.map((node) =>
            node.kind === 'problem' && node.title === graph.goal.title
              ? { ...node, title: next }
              : node,
          ),
        },
    );
    this.#goalListRows.update(goalId, (item) => ({ ...item, goal: { ...item.goal, title: next } }));

    const write = (this.#titleWrites.get(goalId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => goalService.updateTitle(goalId, next));
    this.#titleWrites.set(goalId, write);

    try {
      await write;
      // The goal's management topic was renamed with it.
      const topicId = this.#get().goalGraphById[goalId]?.goal.config?.managerState?.topicId;
      // Loaded on demand: a static import puts the whole chat store on the first screen.
      if (topicId)
        void import('@/store/chat')
          .then(({ useChatStore }) => useChatStore.getState().refreshTopicDetail(topicId, true))
          .catch(() => {});
    } catch (error) {
      // A newer edit is still on its way: re-reading now would show this one's old title over it.
      if (this.#titleWrites.get(goalId) === write) {
        await Promise.allSettled([
          this.refreshGoalGraph(goalId),
          revalidateReplica(goalListResource),
          revalidateReplica(homeGoalListResource),
          revalidateReplica(topicGoalListResource),
        ]);
      }
      throw error;
    } finally {
      if (this.#titleWrites.get(goalId) === write) this.#titleWrites.delete(goalId);
    }
  };

  /**
   * Name the goal from what it asks and what it has produced so far, with the
   * chain and model topics are named with (`summaryTopicTitle`). An empty answer
   * leaves the title alone. Failures reach the caller: the menu reports them,
   * the background rename after creation ignores them.
   */
  autoRenameGoalTitle = async (goalId: string): Promise<void> => {
    if (this.#get().goalTitleRenamingIds.includes(goalId)) return;
    this.#setGoalTitleRenaming(goalId, true);

    try {
      const graph = this.#get().goalGraphById[goalId] ?? (await goalService.getGraph(goalId));
      // A title saved by hand while the model was working is the newer choice.
      const titleWhenAsked = this.#titleShown(goalId) ?? graph.goal.title;
      const { model, provider } = systemAgentSelectors.topic(useUserStore.getState());
      const { data } = await aiChatService.generateJSON(
        {
          ...chainSummaryTitle(
            buildGoalTitleMessages(graph),
            userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
          ),
          metadata: { trigger: RequestTrigger.Goal },
          model,
          provider,
          schema: TOPIC_TITLE_JSON_SCHEMA,
          tracing: {
            promptVersion: TOPIC_TITLE_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TopicTitle,
            schemaName: TOPIC_TITLE_JSON_SCHEMA.name,
          },
        },
        new AbortController(),
      );

      const title = (data as { title?: string } | undefined)?.title?.trim();
      if (!title) throw new Error('No goal title was generated.');

      if ((this.#titleShown(goalId) ?? titleWhenAsked) !== titleWhenAsked) return;

      await this.updateGoalTitle(goalId, title);
    } finally {
      this.#setGoalTitleRenaming(goalId, false);
    }
  };

  /** What the page or a list row shows now; a list row may be all that is loaded. */
  #titleShown = (goalId: string): string | undefined => {
    const state = this.#get();
    const inList = (lists: Record<string, { goals: GoalListItem[] } | undefined>) =>
      Object.values(lists)
        .flatMap((list) => list?.goals ?? [])
        .find((item) => item.goal.id === goalId)?.goal.title;
    return (
      state.goalGraphById[goalId]?.goal.title ??
      inList(state.goalListByAgentId) ??
      inList(state.homeGoalsByScope)
    );
  };

  #setGoalTitleRenaming = (goalId: string, renaming: boolean) => {
    const ids = this.#get().goalTitleRenamingIds.filter((id) => id !== goalId);
    this.#set(
      { goalTitleRenamingIds: renaming ? [...ids, goalId] : ids },
      false,
      'setGoalTitleRenaming',
    );
  };

  /**
   * Ask the server to run the coordinator now. The goal keeps advancing on its
   * own afterwards as its Work Tasks settle, so this is a nudge rather than the
   * loop the surface used to hold open.
   */
  /** The goal's own planning-model provider, so the relay covers the model it plans on. */
  #planningProvider = (goalId: string) =>
    this.#get().goalGraphById[goalId]?.goal.config?.provider ?? undefined;

  advanceGoal = async (goalId: string): Promise<GoalTickResult> => {
    const result = await goalService.advance(goalId, this.#planningProvider(goalId));
    await this.refreshGoalGraph(goalId);
    return result;
  };

  /** Exactly one coordinator step, for a caller that wants to inspect a single move. */
  tickGoal = async (goalId: string): Promise<GoalTickResult> => {
    const result = await goalService.tick(goalId, this.#planningProvider(goalId));
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
   *
   * Read the rows through `goalSelectors.topicGoals`; the persisted copy paints
   * first, and `goalSelectors.topicGoalsConfirmed` says when its statuses are
   * the server's current ones.
   */
  useFetchTopicGoals = (topicId?: string | null, generating?: boolean) => {
    const advancing = useTopicGoalsAdvancing(topicId);
    return this.#topicGoalList.useSync(topicId || null, {
      dedupingInterval: TOPIC_GOALS_DEDUPING_INTERVAL,
      refreshInterval: generating || advancing ? GOAL_GRAPH_POLL_INTERVAL : 0,
      revalidateOnFocus: true,
    });
  };

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
   * Drop one clause so it no longer gates acceptance. Its observations stay in
   * the series; the server reopens a goal this clause alone was parking.
   */
  removeGoalMetric = async (goalId: string, key: string): Promise<void> => {
    await goalService.removeMetricCriteria(goalId, [key]);
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

  setGoalListAgentFilter = (agentId?: string): void => {
    this.#set(
      { goalListAgentFilter: agentId, goalListVisibleLimit: 10 },
      false,
      'setGoalListAgentFilter',
    );
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
  useFetchGoals = (
    agentId?: string,
    projectId?: string,
    filter: GoalListFilter = 'all',
    /** Cache scope of the cross-agent page, read when neither id is given. */
    globalScope?: string,
  ) => {
    const params: GoalListParams | undefined =
      agentId || projectId || globalScope ? { agentId, filter, globalScope, projectId } : undefined;
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
