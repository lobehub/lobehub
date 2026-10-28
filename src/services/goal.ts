import { GOAL_GRAPH_CAPABILITY, type GoalStatus } from '@lobechat/const/goal';
import type {
  GoalCreateConfig,
  GoalGraphSnapshot,
  GoalMetricCriterion,
  GoalNodeKind,
  GoalSubscriptionFreshnessPolicy,
  GoalSubscriptionWakeCondition,
  GoalTickResult,
} from '@lobechat/types';

import { lambdaClient, withLlmRelay } from '@/libs/trpc/client';
import { oneShotRelay } from '@/services/llmRelay';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * The provider a goal's planning runs on: the goal's own planning-model pick
 * when it has one, else the `goal` system agent's — the same choice the server
 * makes, so a device-only provider is relayed back to this tab either way.
 */
const goalModelProvider = (planningProvider?: string) =>
  planningProvider || systemAgentSelectors.goal(useUserStore.getState()).provider;

export interface GoalListParams {
  agentId?: string;
  limit?: number;
  offset?: number;
  projectId?: string;
  statuses?: GoalStatus[];
  /** Goals created from this conversation. */
  topicId?: string;
}

/** Every graph method takes the `goals` row id. */
class GoalService {
  enableSubscription = async (id: string, bindingRevision: number) =>
    (await lambdaClient.goal.enableSubscription.mutate({ id, bindingRevision })).data;
  disableSubscription = async (id: string, bindingRevision: number) =>
    (await lambdaClient.goal.disableSubscription.mutate({ id, bindingRevision })).data;

  listSubscriptions = async (goalId: string) =>
    (await lambdaClient.goal.listSubscriptions.query({ goalId })).data;

  bindSubscription = async (input: {
    goalId: string;
    widgetId: string;
    metricId: string | null;
    criterionKey?: string;
    confirmedVersionId: string;
    confirmedContentHash: string;
    freshnessPolicy: GoalSubscriptionFreshnessPolicy;
    wakeCondition: GoalSubscriptionWakeCondition;
  }) => (await lambdaClient.goal.bindSubscription.mutate(input)).data;

  rebindSubscription = async (
    input: Parameters<GoalService['bindSubscription']>[0] & { id: string; bindingRevision: number },
  ) => (await lambdaClient.goal.rebindSubscription.mutate(input)).data;

  updateSubscription = async (input: {
    id: string;
    bindingRevision: number;
    enabled: boolean;
    freshnessPolicy: GoalSubscriptionFreshnessPolicy;
    wakeCondition: GoalSubscriptionWakeCondition;
  }) => (await lambdaClient.goal.updateSubscription.mutate(input)).data;

  /**
   * List goals. Each item is the execution-carrier task with the goal row
   * attached plus subtree run statistics — see `GoalModel.list` on the server.
   */
  list = async (params: GoalListParams) => lambdaClient.goal.list.query(params);

  /** Create a goal and seed its graph with a problem node and the given Work. */
  create = async (params: {
    agentId?: string;
    config?: GoalCreateConfig;
    /** Set by the `/goal` tool so the seeded graph is authored by the agent. */
    createdByAgentId?: string;
    /** Structured acceptance criteria — persisted rows that gate the terminal acceptance. */
    criteria?: Array<{ description?: string; instruction?: string; title: string }>;
    maxRounds?: number;
    maxTotalCost?: number;
    /** The user's ask in their own words — shown on the seeded problem node. */
    problemDescription?: string;
    projectId?: string;
    requirement?: string;
    title: string;
    work?: Array<{ description?: string; title: string } | string>;
  }): Promise<GoalGraphSnapshot> => {
    const { data } = await lambdaClient.goal.create.mutate(params);
    return data;
  };

  /** Rebind which persisted verify criteria gate this goal's terminal acceptance. */
  setAcceptanceCriteria = async (id: string, criteriaIds: string[]) =>
    lambdaClient.goal.setAcceptanceCriteria.mutate({ criteriaIds, id });

  setMetricCriteria = async (
    id: string,
    metrics: GoalMetricCriterion[],
    mode?: 'merge' | 'replace',
  ) => lambdaClient.goal.setMetricCriteria.mutate({ id, metrics, mode });

  /** Drop declared clauses by key, against the server's current list. */
  removeMetricCriteria = async (id: string, keys: string[]) =>
    lambdaClient.goal.removeMetricCriteria.mutate({ id, keys });

  recordObservation = async (
    id: string,
    observation: { key: string; observedAt?: Date; title?: string; unit?: string; value: number },
  ) => lambdaClient.goal.recordObservation.mutate({ id, ...observation });

  /** Delete a goal and its graph. The dispatched Work Tasks are left in place. */
  delete = async (id: string) => lambdaClient.goal.delete.mutate({ id });

  /** The whole Goal Graph in one read: nodes, edges, decisions, events, work-version links. */
  getGraph = async (id: string): Promise<GoalGraphSnapshot> => {
    // This client draws batches; without the declaration the server sends an
    // older client's shape (see `graphForClient`).
    const { data } = await lambdaClient.goal.graph.query({
      capabilities: [GOAL_GRAPH_CAPABILITY.batch],
      id,
    });
    return data;
  };

  /**
   * Run the coordinator now and report where it stopped. The goal also advances
   * on its own as its Work Tasks settle — this is the explicit nudge, not the
   * engine, so the surface never has to hold a tick loop open. Planning runs
   * on the `goal` model inside this request; a model only this device reaches
   * is relayed back to this tab (one-shot relay).
   */
  advance = async (
    id: string,
    planningProvider?: string,
  ): Promise<GoalTickResult & { ticks: number }> => {
    const { data } = await oneShotRelay.run(goalModelProvider(planningProvider), (relay) =>
      lambdaClient.goal.advance.mutate({ id }, withLlmRelay(relay)),
    );
    return data;
  };

  /** Advance the graph by exactly one coordinator step. Relayed like `advance`. */
  tick = async (id: string, planningProvider?: string): Promise<GoalTickResult> => {
    const { data } = await oneShotRelay.run(goalModelProvider(planningProvider), (relay) =>
      lambdaClient.goal.tick.mutate({ id }, withLlmRelay(relay)),
    );
    return data;
  };

  /** Stop scheduling new work. Does not abort the operation already running. */
  pause = async (id: string) => lambdaClient.goal.pause.mutate({ id });

  resume = async (id: string) => lambdaClient.goal.resume.mutate({ id });

  /** Launch a draft goal; nothing was dispatched before this. */
  start = async (id: string) => lambdaClient.goal.start.mutate({ id });

  /** Answer a goal's whole clarification round; the goal re-plans once with every answer. */
  answerClarifications = async (params: {
    answers: Array<{ decisionId: string; optionId: string; resolution?: string }>;
    id: string;
  }) => lambdaClient.goal.answerClarifications.mutate(params);

  /** Clarifications still waiting on the user, grouped by goal. */
  pendingClarifications = async () => {
    const { data } = await lambdaClient.goal.pendingClarifications.query();
    return data ?? [];
  };

  /** Gates and sign-offs waiting on the user across their goals, for the approval island. */
  pendingForIsland = async () => {
    const { data } = await lambdaClient.goal.pendingForIsland.query();
    return data ?? { decisions: [], signOffs: [] };
  };

  /** End the goal by hand and interrupt its live runs. Reopen with `resume`. */
  close = async (id: string, status: 'achieved' | 'canceled') =>
    lambdaClient.goal.close.mutate({ id, status });

  /** Resolve a pending decision gate. Does not resume a paused goal by itself. */
  decide = async (params: {
    decisionId: string;
    id: string;
    optionId: string;
    resolution?: string;
  }) => lambdaClient.goal.decide.mutate(params);

  /** Hand the goal to another agent; with no executor, its unfinished Tasks follow. */
  setAgent = async (id: string, agentId: string) =>
    lambdaClient.goal.setAgent.mutate({ agentId, id });

  /** Route the goal's Tasks to a dedicated executor; `null` hands them back to the goal agent. */
  setTaskAgent = async (id: string, agentId: string | null) =>
    lambdaClient.goal.setTaskAgent.mutate({ agentId, id });

  /** The model the goal agent plans with; `null` falls back to the agent's own. */
  setModel = async (id: string, modelConfig: { model: string; provider: string } | null) =>
    lambdaClient.goal.setModel.mutate({ id, modelConfig });

  /** The model the goal's Tasks run on; `null` falls back to their executor's own. */
  setTaskModel = async (id: string, modelConfig: { model: string; provider: string } | null) =>
    lambdaClient.goal.setTaskModel.mutate({ id, modelConfig });

  setBudget = async (params: {
    deadline?: string | null;
    id: string;
    maxRounds?: number | null;
    maxTotalCost?: number | null;
  }) => lambdaClient.goal.setBudget.mutate(params);

  /**
   * A batch is only ever created by decomposition, never hand-authored, so the
   * add-node surface accepts every kind except `batch`.
   */
  addNode = async (params: {
    description?: string;
    id: string;
    kind: Exclude<GoalNodeKind, 'batch'>;
    priority?: number;
    title: string;
  }) => lambdaClient.goal.addNode.mutate(params);

  updateRequirement = async (id: string, requirement: string) =>
    lambdaClient.goal.updateRequirement.mutate({ id, requirement });
}

export const goalService = new GoalService();

export type GoalListResult = Awaited<ReturnType<GoalService['list']>>;
export type GoalListItem = GoalListResult['goals'][number];
