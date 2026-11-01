import type { GoalMetricCriteriaState } from '@lobechat/agent-tracing';
import type {
  GoalGraphSnapshot,
  GoalItem,
  GoalMetricCriterion,
  GoalPauseReason,
  MetricKind,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { MetricModel } from '@/database/models/metric';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import {
  compareMetric,
  GOAL_ACCEPTANCE_TASK_TITLE,
  MEASURED_ACCEPTANCE_PAUSE_REASON,
  needsMetricCriteria,
} from '../decideNextMove';
import { GoalManagerService } from '../manager';
import { GoalSubscriptionService } from '../subscriptions';
import { GoalSupervisorService } from '../supervisor';
import { GoalWaitService } from '../wait';
import type { GoalServiceContext } from './types';

/**
 * Replace the goal's structured acceptance criteria id list (goal-page
 * editing). The criteria rows themselves are edited through the verify
 * criteria endpoints; this only rebinds which of them gate the goal.
 */
/**
 * Declare (or clear) the numeric clauses that gate this goal's acceptance.
 *
 * Merged into `config.acceptance` so it cannot clobber the delivery criteria
 * binding, and settable after creation because a long-horizon goal learns its
 * real thresholds while it runs. Relaxing a clause can unblock a goal that is
 * already parked short of acceptance — the same reason extending a deadline
 * resumes a budget-stopped one — so the caller schedules an advance.
 */
/**
 * Write a measurement against this goal, and reopen it when that measurement
 * is what it was waiting for.
 *
 * The gate parks the goal (see the `measured_acceptance` branch), and `tick`
 * refuses to move a paused goal — so without the reopen here the observation
 * would land and nothing would happen. Only a goal the gate actually stopped
 * is reopened, and only once every clause holds: the same discipline
 * `setBudget` uses, so a deliberate pause is never undone by a stray sample
 * and a still-short measurement does not queue a no-op advance.
 */
export const recordObservation = async (
  ctx: GoalServiceContext,
  goalId: string,
  input: {
    key: string;
    kind?: MetricKind;
    observedAt?: Date;
    title?: string;
    unit?: string;
    value: number;
  },
) => {
  const goal = await ctx.goalModel.findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

  const metricModel = new MetricModel(ctx.db, ctx.userId, ctx.workspaceId);
  const series = await metricModel.ensure({
    key: input.key,
    kind: input.kind,
    subjectId: goal.id,
    subjectType: 'goal',
    title: input.title,
    unit: input.unit,
  });
  if (!series)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Metric series slot is owned by another scope',
    });

  const point = await metricModel.addPoint(series.id, {
    actorId: ctx.userId,
    actorType: 'user',
    observedAt: input.observedAt ?? new Date(),
    sourceType: 'manual',
    value: input.value,
  });

  const manager = goal.config?.managerState;
  if (
    manager?.wait &&
    point &&
    new Date(point.observedAt).getTime() >= Date.parse(manager.startedAt)
  ) {
    await new GoalWaitService(ctx.db, ctx.userId, ctx.workspaceId).deliver(goalId, {
      waitToken: manager.token,
      eventId: point.id,
      type: 'metric.observed',
      key: input.key,
      reference: series.id,
      summary: `${input.key} = ${input.value} at ${point.observedAt}`,
    });
  }
  return { point, series, shouldAdvance: await ctx.reopenIfMeasurementCleared(goalId) };
};

/**
 * Whether the coordinator is worth waking: either the goal is already
 * running, or the coordinator itself parked it on a measured gate that no
 * longer holds it.
 *
 * The `pausedBy` marker is what makes this safe. A goal paused by a person
 * looks exactly like one parked by the gate — same status, same terminal
 * phase, same clauses — so without it an arriving measurement would restart
 * a goal somebody deliberately stopped.
 *
 * "No longer holds it" covers both ways out: every clause now satisfied, and
 * the clauses being dropped altogether (`setMetricCriteria(id, [])`), which
 * otherwise left the goal parked on a gate that no longer existed.
 */
export const reopenIfMeasurementCleared = async (
  ctx: GoalServiceContext,
  goalId: string,
  /**
   * Whether the gate held the goal *before* the caller's edit, for callers
   * that change the clauses themselves: dropping the last one erases the
   * evidence, so the verdict is taken from the state that preceded it — the
   * same way `setBudget` reads what was binding before it wrote.
   */
  parkedBeforeEdit?: boolean,
): Promise<boolean> => {
  const graph = await ctx.coordinatorGraph.getGraph(goalId);
  if (!graph) return false;
  if (graph.goal.status !== 'paused') return true;
  if (!(parkedBeforeEdit ?? ctx.isParkedOnMeasuredGate(graph))) return false;

  if (needsMetricCriteria(graph)) {
    const { allMet } = await ctx.evaluateMetricCriteria(graph);
    if (!allMet) return false;
  }

  await ctx.setPauseReason(goalId, undefined);
  await ctx.transitionStatus(graph.goal, 'running', 'a measurement cleared the acceptance gate');
  return true;
};

/**
 * Record (or clear) why the coordinator is holding this goal paused.
 *
 * Kept on the goal's JSONB config rather than derived from the event log:
 * control flow should not depend on a capped audit trail, and the marker has
 * to survive for as long as the pause does — which for a long-horizon goal
 * is the whole wait.
 */
export const setPauseReason = async (
  ctx: GoalServiceContext,
  goalId: string,
  reason: GoalPauseReason | undefined,
) => {
  await ctx.goalModel.updatePauseReason(goalId, reason);
};

/**
 * Whether the coordinator is the one holding this paused goal.
 *
 * The marker answers it outright. Goals parked before the marker existed —
 * and any parked by an old worker mid-deploy — carry none, so fall back to
 * who performed the transition: every status change records a goal-entity
 * event, and the newest one is by definition the transition that produced
 * the current status. A coordinator park is attributed to `system`, a user
 * pause to `user`, so the two stay distinguishable without the marker.
 *
 * Absent both, the pause is left alone: a goal wrongly resumed spends money
 * against an explicit human decision, while one left parked says so on its
 * row and is one Resume away.
 */
export const isParkedOnMeasuredGate = (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): boolean => {
  if (graph.goal.status !== 'paused') return false;
  if (graph.goal.config?.pausedBy) return graph.goal.config.pausedBy === 'measured_acceptance';

  // Match the park this gate actually recorded, not merely "the coordinator
  // paused it": it also parks goals that are blocked or out of budget, and an
  // unrelated sample must not restart either. The newest goal-entity event is
  // by definition the transition that produced the current status; if two
  // share a millisecond and the read picks the other one, the result is a
  // missed reopen rather than a wrongful one.
  const lastTransition = graph.events.find((event) => event.entityType === 'goal');
  return (
    lastTransition?.actorType !== 'user' &&
    !!lastTransition?.reason?.startsWith(MEASURED_ACCEPTANCE_PAUSE_REASON) &&
    needsMetricCriteria(graph)
  );
};

export const setMetricCriteria = async (
  ctx: GoalServiceContext,
  goalId: string,
  metrics: GoalMetricCriterion[],
  /**
   * `merge` upserts by key into the list as it stands on the server —
   * for callers declaring one clause, whose own snapshot may be stale.
   * A client-built replacement array would silently drop whatever a
   * concurrent editor or agent declared since that snapshot was read.
   */
  mode: 'merge' | 'replace' = 'replace',
) =>
  updateMetricCriteria(ctx, goalId, (current) =>
    mode === 'merge'
      ? [...current.filter((item) => !metrics.some((m) => m.key === item.key)), ...metrics]
      : metrics,
  );

/**
 * Drop clauses by key, against the list as it stands on the server — for the
 * same reason `merge` exists: a client filtering its own snapshot would put
 * back whatever was removed or declared since it read.
 */
export const removeMetricCriteria = async (
  ctx: GoalServiceContext,
  goalId: string,
  keys: string[],
) =>
  updateMetricCriteria(ctx, goalId, (current) =>
    current.filter((item) => !keys.includes(item.key)),
  );

const updateMetricCriteria = async (
  ctx: GoalServiceContext,
  goalId: string,
  edit: (current: GoalMetricCriterion[]) => GoalMetricCriterion[],
) => {
  const before = await ctx.coordinatorGraph.getGraph(goalId);
  if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  const parkedOnGate = ctx.isParkedOnMeasuredGate(before);
  // Read and write the list under the goal's row lock: two editors deriving
  // their list from the same snapshot would otherwise race, resurrecting a
  // removed clause or dropping a newly declared one.
  await ctx.db.transaction(async (tx) => {
    const model = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const next = edit(goal.config?.acceptance?.metrics ?? []);
    await model.update(goalId, {
      config: {
        ...goal.config,
        acceptance: {
          ...goal.config?.acceptance,
          metrics: next.length > 0 ? next : undefined,
        },
      },
    });
  });
  // Relaxing or dropping a clause can clear a gate the goal is parked on.
  await ctx.reopenIfMeasurementCleared(goalId, parkedOnGate);
  return ctx.graph(goalId);
};

/**
 * Every declared clause beside the value the gate would read for it right now.
 *
 * The graph carries only the declarations, so a reader of it — a planning
 * Agent above all — could not tell a clause nobody measured from one already
 * met, and kept resubmitting verification against a gate that had cleared.
 */
export const metricState = async (ctx: GoalServiceContext, goalId: string) => {
  const graph = await ctx.requireGraph(goalId);
  const declared = graph.goal.config?.acceptance?.metrics ?? [];
  if (declared.length === 0) return { allMet: true, criteria: [] };
  const state = await ctx.evaluateMetricCriteria(graph);
  return {
    allMet: state.allMet,
    criteria: state.criteria.map((criterion) => ({
      ...criterion,
      title: declared.find((item) => item.key === criterion.key)?.title,
    })),
  };
};

export const setAcceptanceCriteria = async (
  ctx: GoalServiceContext,
  goalId: string,
  criteriaIds: string[],
) => {
  const goal = await ctx.goalModel.findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  await ctx.goalModel.update(goalId, {
    config: { ...goal.config, acceptance: { ...goal.config?.acceptance, criteriaIds } },
  });

  // A terminal Goal-acceptance Task may already be dispatched — its
  // Acceptance row snapshotted the previous id list. Rebind it too, or the
  // page would present the new criteria as gates while the verifier keeps
  // materializing plans from the stale list. A verify round already
  // materialized for an in-flight run stays as-is (rounds are immutable
  // snapshots); every later run instantiates from the updated config.
  const graph = await ctx.graphModel.getGraph(goalId);
  const terminalTaskId = graph?.nodes.find(
    (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE && node.taskId,
  )?.taskId;
  if (!terminalTaskId) return;

  const acceptance = await ctx.acceptanceService.acceptanceModel.findBySubject(
    'task',
    terminalTaskId,
  );
  if (!acceptance || acceptance.status === 'accepted') return;
  await ctx.acceptanceService.acceptanceModel.update(acceptance.id, {
    config: {
      ...acceptance.config,
      ...(criteriaIds.length > 0
        ? { verifyCriteriaIds: criteriaIds }
        : { verifyCriteriaIds: undefined }),
    },
  });
};

/**
 * What the goal has spent against what it is allowed to spend.
 *
 * Rounds are counted across every Task in the graph, not per Task — the
 * budget is the goal's, so `setBudget` has to read it exactly the way the
 * coordinator does or raising a budget would not reliably unstick a goal.
 *
 * The calendar-time budget (schedule.deadline) is evaluated in the same
 * shape: time is the long-horizon budget unit the attempt/round/dollar trio
 * cannot express, and a goal whose deadline passed must stop the same way a
 * goal out of money does.
 */
/**
 * Read every declared numeric clause against its series' latest observation.
 *
 * A missing series or a series with no points reads as `null` and fails its
 * clause: "never measured" is not "satisfied". The measured value is carried
 * out with the verdict so the trajectory records what the decision saw.
 */
export const evaluateMetricCriteria = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  /** Pass a transaction to hold the evidence locks until the caller commits. */
  db: LobeChatDatabase = ctx.db,
): Promise<GoalMetricCriteriaState> => {
  const declared = graph.goal.config?.acceptance?.metrics ?? [];
  const metricModel = new MetricModel(db, ctx.userId, ctx.workspaceId);

  // Two queries for the whole contract, not two per clause: this runs on
  // every terminal tick, and a goal carrying a large acceptance payload would
  // otherwise pace the connection pool for unrelated requests. Only the
  // declared keys are fetched — the same goal can accumulate any number of
  // other sampled series, and none of them can gate acceptance.
  const series = await metricModel.findByKeys(
    'goal',
    graph.goal.id,
    declared.map((criterion) => criterion.key),
  );
  const seriesByKey = new Map(series.map((item) => [item.key, item]));
  const latestByMetricId = await metricModel.latestPointsByMetricIds(
    declared.flatMap((criterion) => {
      const id = seriesByKey.get(criterion.key)?.id;
      return id ? [id] : [];
    }),
  );

  // A clause bound to a Widget subscription reads that subscription's accepted
  // observation (fresh, provenance-checked); an unbound clause keeps reading the
  // series' latest point.
  const subscriptions = await new GoalSubscriptionService(db, ctx.userId, ctx.workspaceId).criteria(
    graph.goal.id,
    declared.map((criterion) => criterion.key),
  );
  const criteria = declared.map((criterion) => {
    const op = criterion.op ?? 'gte';
    const seriesId = seriesByKey.get(criterion.key)?.id;
    const subscription = subscriptions.get(criterion.key);
    const point = subscription?.bound
      ? subscription.point
      : seriesId
        ? latestByMetricId.get(seriesId)
        : undefined;
    const value = point?.value ?? null;
    return {
      key: criterion.key,
      met: value !== null && compareMetric(value, op, criterion.target),
      observedAt: point ? new Date(point.observedAt).getTime() : undefined,
      op,
      target: criterion.target,
      value,
    };
  });

  return { allMet: criteria.every((criterion) => criterion.met), criteria };
};

export const evaluateBudget = async (
  ctx: GoalServiceContext,
  goal: GoalItem,
  graph: GoalGraphSnapshot,
) => {
  const { runs, totalCost } = await ctx.resolveSpend(graph);
  const deadline = goal.config?.schedule?.deadline ?? null;
  return {
    costLimitReached: goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost),
    deadline,
    deadlinePassed: deadline !== null && Date.now() >= new Date(deadline).getTime(),
    roundLimitReached: goal.maxRounds !== null && runs >= goal.maxRounds,
    runs,
    totalCost,
  };
};

/**
 * Rounds run and dollars spent, by the definition the budget is enforced
 * against: the runs of the graph's own Task nodes.
 *
 * `graph()` ships this to the client so the page's spend reads the same
 * number the coordinator will stop on. Note it is deliberately NOT the goal
 * list's `totalRunCost`, which walks the whole `parent_task_id` subtree —
 * that number is larger for a goal whose Tasks spawned Tasks.
 */
export const resolveSpend = async (ctx: GoalServiceContext, graph: GoalGraphSnapshot) => {
  const [spend, supervision, management] = await Promise.all([
    ctx.taskTopicModel.sumRunCostByTaskIds(
      graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])),
    ),
    new GoalSupervisorService(ctx.db, ctx.userId, ctx.workspaceId).usage(
      graph.goal.config?.supervisorState,
    ),
    new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId).usage(
      graph.goal.id,
      graph.goal.config?.managerState,
    ),
  ]);
  return {
    ...spend,
    totalCost: spend.totalCost + supervision.totalCost + management.totalCost,
    totalTokens: spend.totalTokens + supervision.totalTokens + management.totalTokens,
  };
};
