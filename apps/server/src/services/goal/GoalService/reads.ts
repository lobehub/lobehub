import type {
  GoalDecisionOption,
  GoalEventEntityType,
  GoalEventType,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalNodeAcceptance,
  GoalStatus,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { classifyRunFailure, QUOTA_RESET_MARGIN_MS } from '../recoveryPolicy';
import { GoalReportStore } from '../reportStore';
import type { GoalServiceContext } from './types';

export const graph = async (ctx: GoalServiceContext, goalId: string) => {
  const graph = await ctx.requireGraph(goalId);
  const [runHeartbeats, deliveredAt, quotaRetryAt, acceptances, assignees, spend, report] =
    await Promise.all([
      ctx.collectRunHeartbeats(graph),
      ctx.collectDeliveredAt(graph),
      ctx.collectQuotaWaits(graph),
      ctx.collectAcceptances(graph),
      ctx.collectAssignees(graph),
      ctx.resolveSpend(graph),
      new GoalReportStore(ctx.db, ctx.userId, ctx.workspaceId).state(graph),
    ]);
  // Numeric clauses read through the Goal's Widget subscriptions when bound, so
  // the page shows the same verdict the coordinator acts on.
  const metricCriteria = await ctx.evaluateMetricCriteria(graph);
  return {
    ...graph,
    acceptances,
    assignees,
    deliveredAt,
    metricCriteria,
    quotaRetryAt,
    report,
    runHeartbeats,
    spend,
  };
};

/**
 * The goal's audit trail, newest first, paged past the capped copy `graph()`
 * carries. `graph()` stays the shape the page reads; this is for a reader
 * chasing one transition — the pause that explains why a plan was refused
 * hours into a run, say. Returns the cursor that continues the page.
 */
export const listEvents = async (
  ctx: GoalServiceContext,
  goalId: string,
  options: {
    cursor?: { createdAt: Date; id: string };
    entityType?: GoalEventEntityType;
    eventType?: GoalEventType;
    limit: number;
  },
) => {
  const page = await ctx.graphModel.listEvents(goalId, options);
  if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return page;
};

/**
 * The agent each dispatched task node is assigned to. Read from the Task row
 * rather than the goal config: a task can be reassigned on its own, and the
 * row is what the runner actually dispatches to.
 */
export const collectAssignees = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, string> | undefined> => {
  const taskNodes = graph.nodes.filter(
    (node): node is GoalGraphNode & { taskId: string } => node.kind === 'task' && !!node.taskId,
  );
  if (taskNodes.length === 0) return undefined;

  const nodeByTaskId = new Map(taskNodes.map((node) => [node.taskId, node.id]));
  // Runs on every graph poll: read the one column, not whole task rows.
  const tasks = await ctx.taskModel.findAssigneesByIds(taskNodes.map((node) => node.taskId));

  const result: Record<string, string> = {};
  for (const task of tasks) {
    const nodeId = nodeByTaskId.get(task.id);
    if (nodeId && task.assigneeAgentId) result[nodeId] = task.assigneeAgentId;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * Verification state per task node.
 *
 * Every dispatched task already owns an Acceptance (`createResponsibleTask`
 * creates one), but the goal surfaced only the criteria it would be judged
 * against — never the judgment. A reader could see that a task finished and
 * still have no idea whether it held up, which is the gap that made the page
 * feel unverifiable.
 *
 * Each level's tally rides along so the page can show its standing without
 * opening it. That tally is counted from the same check union the level
 * expands to (so a summary row can never contradict its own list), and it is
 * one batched read, never one per acceptance — this runs on every graph poll.
 */
export const collectAcceptances = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, GoalNodeAcceptance> | undefined> => {
  const taskNodes = graph.nodes.filter(
    (node): node is GoalGraphNode & { taskId: string } => node.kind === 'task' && !!node.taskId,
  );
  if (taskNodes.length === 0) return undefined;

  const nodeByTaskId = new Map(taskNodes.map((node) => [node.taskId, node.id]));
  const rows = await ctx.acceptanceService.acceptanceModel.findBySubjects(
    'task',
    taskNodes.map((node) => node.taskId),
  );

  // An acceptance with no round yet is absent from the tally map, not zero —
  // keep "no round" and "judged nothing" apart on the page.
  const tallies = await ctx.acceptanceService.getCheckTalliesByAcceptances(
    rows.map((row) => row.id),
  );

  const result: Record<string, GoalNodeAcceptance> = {};
  for (const row of rows) {
    const nodeId = nodeByTaskId.get(row.subjectId);
    if (!nodeId) continue;
    const checks = tallies.get(row.id);
    result[nodeId] = { id: row.id, status: row.status, ...(checks ? { checks } : {}) };
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * When an active task node's newest run delivered, for the nodes waiting on
 * verification to settle.
 *
 * A verify-bound task keeps its node `active` while its topic is already
 * `completed`, and the judgment is a full agent run that routinely outlives
 * the operation lease — `decideNextMove` holds off re-dispatching such a node
 * for a whole `VERIFY_SETTLE_GRACE_MS`. But a completed topic is not a
 * *running* one, so it contributes no heartbeat, and a client judging
 * liveness from heartbeats alone declared the goal's most informative moment
 * — delivered, being verified — lost. Reporting the delivery instant lets the
 * client name that state and apply the coordinator's own grace window instead
 * of the lease.
 */
export const collectDeliveredAt = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, Date> | undefined> => {
  const activeTasks = graph.nodes.filter(
    (node): node is GoalGraphNode & { taskId: string } =>
      node.kind === 'task' && node.status === 'active' && !!node.taskId,
  );
  if (activeTasks.length === 0) return undefined;

  const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
  // Newest run per task: `findWithHandoffByTaskIds` orders by seq desc, so the
  // first row seen for a task is its latest.
  const topics = await ctx.taskTopicModel.findWithHandoffByTaskIds(
    activeTasks.map((n) => n.taskId),
    activeTasks.length,
  );

  const delivered: Record<string, Date> = {};
  const seen = new Set<string>();
  for (const topic of topics) {
    const taskId = topic.sourceTaskId;
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    const nodeId = nodeByTaskId.get(taskId);
    // Only the newest run counts, and only while it is a delivery: an older
    // completed run under a newer running one is history, not a pending
    // verification.
    if (!nodeId || topic.status !== 'completed') continue;
    delivered[nodeId] = topic.completedAt ?? topic.createdAt;
  }

  return Object.keys(delivered).length > 0 ? delivered : undefined;
};

/**
 * When the coordinator retries each active task node a usage window refused.
 *
 * `waitForQuotaReset` holds such a Task `paused` and books its own wake for the
 * reset, so the run behind it has ended and sends no heartbeat. A client judging
 * liveness from heartbeats alone called that wait lost — a red failure badge on
 * a Task the coordinator will resume on its own. This reads the same failure
 * classification the coordinator does, so the page names the wait and its time.
 */
export const collectQuotaWaits = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, Date> | undefined> => {
  const activeTasks = graph.nodes.filter(
    (node): node is GoalGraphNode & { taskId: string } =>
      node.kind === 'task' && node.status === 'active' && !!node.taskId,
  );
  if (activeTasks.length === 0) return undefined;

  const paused = (await ctx.taskModel.findByIds(activeTasks.map((node) => node.taskId))).filter(
    (task) => task.status === 'paused',
  );
  if (paused.length === 0) return undefined;

  const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
  const operationModel = new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId);
  const waits: Record<string, Date> = {};
  // Paused active Tasks are rare, so the per-task read stays off the common poll;
  // the cap keeps a goal with many held Tasks from bursting the pool on every poll.
  await pMap(
    paused,
    async (task) => {
      const [latest] = await ctx.taskTopicModel.findWithHandoff(task.id, 1);
      if (!latest?.operationId) return;
      const operation = await operationModel.findById(latest.operationId);
      const failure = classifyRunFailure(operation?.error, task.error ?? '');
      const nodeId = nodeByTaskId.get(task.id);
      if (failure.kind !== 'quota_reset' || !nodeId) return;
      waits[nodeId] = new Date(failure.resetsAt! + QUOTA_RESET_MARGIN_MS);
    },
    { concurrency: 5 },
  );

  return Object.keys(waits).length > 0 ? waits : undefined;
};

/**
 * Live heartbeat per active task node: the `agent_operations.updatedAt` of
 * the run behind it. The runtime refreshes that lease every ~90s while
 * `goal_nodes.updatedAt` only moves on observations / status changes, so a
 * client judging liveness from the node row alone would cry "lost" over any
 * long quiet stretch (a big tool call, the verify stage) the reclaim path
 * considers perfectly healthy.
 */
export const collectRunHeartbeats = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<Record<string, Date> | undefined> => {
  const activeTasks = graph.nodes.filter(
    (node): node is GoalGraphNode & { taskId: string } =>
      node.kind === 'task' && node.status === 'active' && !!node.taskId,
  );
  if (activeTasks.length === 0) return undefined;

  const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
  const running = await ctx.taskTopicModel.findRunningByTaskIds(activeTasks.map((n) => n.taskId));

  // One batched read: the graph polls every few seconds per open client, so
  // a per-topic operation lookup would scale queries with task concurrency.
  const operationIds = [
    ...new Set(running.flatMap((topic) => (topic.operationId ? [topic.operationId] : []))),
  ];
  const operations = await new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId).findByIds(
    operationIds,
  );
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));

  const heartbeats: Record<string, Date> = {};
  for (const topic of running) {
    const nodeId = topic.taskId ? nodeByTaskId.get(topic.taskId) : undefined;
    if (!nodeId || !topic.operationId || heartbeats[nodeId]) continue;
    const updatedAt = operationById.get(topic.operationId)?.updatedAt;
    if (updatedAt) heartbeats[nodeId] = updatedAt;
  }

  return Object.keys(heartbeats).length > 0 ? heartbeats : undefined;
};

/** Current lifecycle status, without paying for the whole graph. */
export const status = async (
  ctx: GoalServiceContext,
  goalId: string,
): Promise<GoalStatus | undefined> => (await ctx.goalModel.findById(goalId))?.status;

/**
 * Everything the approval island asks outside a goal's page: the gates
 * waiting on the person (clarification rounds have their own form) and the
 * finished goals waiting for their sign-off.
 */
export const pendingForIsland = async (ctx: GoalServiceContext) => {
  const [decisions, signOffs] = await Promise.all([
    ctx.goalModel.listPendingDecisions(),
    ctx.briefs.listOpenSignOffs(),
  ]);
  return {
    decisions: decisions.map((row) => ({ ...row, options: row.options ?? [] })),
    signOffs,
  };
};

/** Pending clarifications grouped by goal, for surfaces outside the goal page. */
export const pendingClarifications = async (ctx: GoalServiceContext) => {
  const rows = await ctx.goalModel.listPendingClarifications();
  const byGoal = new Map<
    string,
    {
      agentId: string | null;
      goalId: string;
      questions: Array<{
        decisionId: string;
        description: string | null;
        options: GoalDecisionOption[];
        question: string;
      }>;
      requirement: string | null;
      title: string;
    }
  >();
  for (const row of rows) {
    const group = byGoal.get(row.goalId) ?? {
      agentId: row.agentId,
      goalId: row.goalId,
      questions: [],
      requirement: row.requirement,
      title: row.goalTitle,
    };
    group.questions.push({
      decisionId: row.decisionId,
      description: row.description,
      options: row.options ?? [],
      question: row.question,
    });
    byGoal.set(row.goalId, group);
  }
  return [...byGoal.values()];
};

export const requireGraph = async (ctx: GoalServiceContext, goalId: string) => {
  const graph = await ctx.graphModel.getGraph(goalId);
  if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return graph;
};
