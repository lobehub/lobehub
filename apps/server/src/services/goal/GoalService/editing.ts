import type { GoalEdgeKind, GoalItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';

import { TaskService } from '../../task';
import { GoalAssignmentService } from '../assignment';
import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  NO_FRONTIER_PAUSE_REASON,
  TERMINAL_NODE_STATUSES,
} from '../decideNextMove';
import { managerTurnsSpent } from '../recoveryPolicy';
import { isGoalReportNode } from '../report';
import type { CreateGoalNodeInput, GoalServiceContext } from './types';

/**
 * The graph model whose audit trail names `agentId` as the author, or the
 * user-attributed one when a person is calling.
 */
export const graphAs = (ctx: GoalServiceContext, agentId?: string) =>
  agentId
    ? new GoalGraphModel(ctx.db, ctx.userId, ctx.workspaceId, { id: agentId, type: 'agent' })
    : ctx.graphModel;

export const addNode = async (
  ctx: GoalServiceContext,
  goalId: string,
  input: CreateGoalNodeInput,
) => {
  const node = await ctx.graphModel.createNode(goalId, input);
  if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return node;
};

export const addEdge = async (
  ctx: GoalServiceContext,
  goalId: string,
  sourceNodeId: string,
  targetNodeId: string,
  kind: GoalEdgeKind,
) => {
  const edge = await ctx.graphModel.createEdge(goalId, sourceNodeId, targetNodeId, kind);
  if (!edge) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return edge;
};

/**
 * Edit the goal's standing acceptance requirement in place. The next
 * coordinator move and every later dispatched Task read the updated text;
 * an already-running Task keeps the contract it was dispatched with.
 */
export const updateRequirement = async (
  ctx: GoalServiceContext,
  goalId: string,
  requirement: string,
) => {
  const goal = await ctx.goalModel.update(goalId, { requirement });
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return goal;
};

/**
 * Rename the goal. Only the label changes: the requirement and the Tasks already
 * dispatched keep their own text. The map's root question and the management
 * topic were named after the goal, so they follow unless someone renamed them.
 */
export const updateTitle = async (ctx: GoalServiceContext, goalId: string, title: string) => {
  // The goal row is locked so concurrent renames apply to all three in the same order.
  return ctx.db.transaction(async (tx) => {
    const goalModel = new GoalModel(tx, ctx.userId, ctx.workspaceId);
    const previous = await goalModel.findByIdForUpdate(goalId);
    if (!previous) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const goal = await goalModel.update(goalId, { title });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    if (previous.title === title) return goal;

    await new GoalGraphModel(tx, ctx.userId, ctx.workspaceId).renameProblemNode(
      goalId,
      previous.title,
      title,
    );

    const topicId = goal.config?.managerState?.topicId;
    if (topicId) {
      const topicModel = new TopicModel(tx, ctx.userId, ctx.workspaceId);
      const topic = await topicModel.findById(topicId);
      if (topic?.title === `Goal management: ${previous.title}`)
        await topicModel.update(topicId, { title: `Goal management: ${title}` });
    }
    return goal;
  });
};

/**
 * Who works on a goal and with which model lives in `GoalAssignmentService`:
 * handoffs, the Task executor and both model slots share its locked
 * transactions, so these methods only bind it to this service's principal.
 */
const assignmentFor = (ctx: GoalServiceContext) =>
  new GoalAssignmentService(ctx.db, ctx.userId, ctx.workspaceId);

/** Hand the goal to a different agent; see `GoalAssignmentService.setAgent`. */
export const setAgent = (
  ctx: GoalServiceContext,
  ...args: Parameters<GoalAssignmentService['setAgent']>
) => assignmentFor(ctx).setAgent(...args);

/** Unfinished Tasks follow a new goal agent; see `GoalAssignmentService.followGoalAgent`. */
export const followGoalAgent = (
  ctx: GoalServiceContext,
  ...args: Parameters<GoalAssignmentService['followGoalAgent']>
) => assignmentFor(ctx).followGoalAgent(...args);

/** Route Tasks to a dedicated executor; see `GoalAssignmentService.setTaskAgent`. */
export const setTaskAgent = (
  ctx: GoalServiceContext,
  ...args: Parameters<GoalAssignmentService['setTaskAgent']>
) => assignmentFor(ctx).setTaskAgent(...args);

/** The model planning turns run on; see `GoalAssignmentService.setModel`. */
export const setModel = (
  ctx: GoalServiceContext,
  ...args: Parameters<GoalAssignmentService['setModel']>
) => assignmentFor(ctx).setModel(...args);

/** The model the goal's Tasks run on; see `GoalAssignmentService.setTaskModel`. */
export const setTaskModel = (
  ctx: GoalServiceContext,
  ...args: Parameters<GoalAssignmentService['setTaskModel']>
) => assignmentFor(ctx).setTaskModel(...args);

/** The agent the next coordinator-created Task goes to. */
export const resolveTaskAssignee = (ctx: GoalServiceContext, goal: GoalItem) =>
  assignmentFor(ctx).resolveTaskAssignee(goal);

/** Move unfinished Tasks (and their model) to `agentId`. */
export const reassignUnfinishedTasks = (ctx: GoalServiceContext, goalId: string, agentId: string) =>
  assignmentFor(ctx).reassignUnfinishedTasks(goalId, agentId);

/**
 * Task access under the goal owner's principal — the identity the goal's
 * coordinator creates and runs its Tasks as. Only for acting on Tasks already
 * bound to this goal's nodes, after the caller's right to manage the goal has
 * been checked.
 */
export const goalOwnerTaskScope = (ctx: GoalServiceContext, goal: { userId: string }) =>
  goal.userId === ctx.userId
    ? {
        taskModel: ctx.taskModel,
        taskService: ctx.taskService,
        taskTopicModel: ctx.taskTopicModel,
      }
    : {
        taskModel: new TaskModel(ctx.db, goal.userId, ctx.workspaceId),
        taskService: new TaskService(ctx.db, goal.userId, ctx.workspaceId),
        taskTopicModel: new TaskTopicModel(ctx.db, goal.userId, ctx.workspaceId),
      };

/**
 * Stop the Tasks bound to nodes already fenced as `retired`, so a retired
 * node cannot keep spending or deliver into the Goal afterwards. Bound Tasks
 * are read after the fence so a Task bound just before it is included.
 * Returns the graph as read after the fence.
 */
export const stopFencedTasks = async (
  ctx: GoalServiceContext,
  goalId: string,
  targetIds: ReadonlySet<string>,
) => {
  const fenced = await ctx.requireGraph(goalId);
  const taskIds = fenced.nodes.flatMap((node) =>
    targetIds.has(node.id) && node.taskId ? [node.taskId] : [],
  );
  if (taskIds.length > 0) {
    // The caller may be a workspace owner retiring a colleague's goal (the
    // router authorizes that). The nodes' Tasks were created by the goal's
    // coordinator, which runs as the goal's owner — and may be `private`,
    // inherited from that owner's private agent — so reads under the caller's
    // visibility would miss them and leave them running. Stop them under the
    // goal owner's principal instead, limited to the Tasks bound to the nodes
    // being retired.
    const { taskModel, taskService, taskTopicModel } = ctx.goalOwnerTaskScope(fenced.goal);
    const cancelTasks = async () => {
      for (const id of taskIds) {
        // CAS against the status just read; a runner flipping the Task to
        // `running` in between makes it miss, so re-read and try again.
        for (let attempt = 0; attempt < 3; attempt++) {
          const [task] = await taskModel.findByIds([id]);
          if (!task || ['canceled', 'completed', 'failed'].includes(task.status)) break;
          if (await taskModel.updateStatusIfCurrent(id, task.status, 'canceled')) break;
        }
      }
    };
    // Cancel the Tasks FIRST: that is the fence a run still being dispatched
    // checks under the Task's row lock before recording its operation, so a
    // run started from here on stops itself (TaskRunnerService.runTask).
    // Runs recorded before the fence are then found and stopped below.
    await cancelTasks();
    for (const topic of await taskTopicModel.findRunningByTaskIds(taskIds)) {
      if (topic.topicId) await taskService.cancelTopic(topic.topicId);
    }
    // `cancelTopic` parks its Task as `paused`; settle them back to canceled.
    await cancelTasks();
  }

  return fenced;
};

/**
 * Retire Task nodes a person no longer wants run — a duplicated plan branch,
 * work that landed elsewhere. Without this a stray node that never got a Task
 * stays unfinished forever and the coordinator can never reach acceptance.
 *
 * Nodes are retired as one set: any unfinished Task still depending on a node
 * in the set must be in the set too, otherwise it would wait on a
 * prerequisite that will never resolve.
 */
export const retireNodes = async (
  ctx: GoalServiceContext,
  goalId: string,
  nodeIds: string[],
  reason?: string,
): Promise<{ retiredNodeIds: string[] }> => {
  const graph = await ctx.requireGraph(goalId);
  const targetIds = new Set(nodeIds);

  const targets = [...targetIds].map((nodeId) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: `Node ${nodeId} not found` });
    if (node.kind !== 'task') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Node ${nodeId} is a ${node.kind}; only task nodes can be retired`,
      });
    }
    // An already-retired node is accepted so an interrupted retirement (its
    // fence landed, stopping the run did not) can be finished by retrying.
    if (node.status !== 'retired' && TERMINAL_NODE_STATUSES.has(node.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Node ${nodeId} is already ${node.status}`,
      });
    }
    // Retiring the terminal acceptance fails the whole Goal; that verdict
    // belongs to its decision gate, not to a graph edit.
    if (node.title === GOAL_ACCEPTANCE_TASK_TITLE) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The Goal acceptance task cannot be retired',
      });
    }
    return node;
  });

  const strandedIds = graph.edges
    .filter(
      (edge) =>
        edge.kind === 'depends_on' &&
        targetIds.has(edge.targetNodeId) &&
        !targetIds.has(edge.sourceNodeId),
    )
    .map((edge) => graph.nodes.find((node) => node.id === edge.sourceNodeId))
    .filter(
      (node): node is NonNullable<typeof node> =>
        !!node && node.kind === 'task' && !TERMINAL_NODE_STATUSES.has(node.status),
    )
    .map((node) => node.id);
  if (strandedIds.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Unfinished tasks depend on these nodes; retire them together: ${[...new Set(strandedIds)].join(', ')}`,
    });
  }

  // Fence the nodes BEFORE looking for their Tasks. The snapshot above can
  // miss a Task a concurrent tick is creating for a proposed node; once the
  // node reads `retired`, `bindTask` (which only binds an `active` node) can
  // no longer attach that Task, and the creator discards it.
  for (const node of targets) {
    if (node.status === 'retired') continue;
    await ctx.graphModel.updateNodeStatus(goalId, node.id, 'retired', reason);
  }

  // Stop what the nodes are still running, so a retired node cannot keep
  // spending or deliver into the Goal afterwards.
  const fenced = await ctx.stopFencedTasks(goalId, targetIds);

  // A pending recovery gate on a retired node asks a question nobody needs
  // answered any more; left pending it keeps the Goal parked in review.
  for (const decision of fenced.decisions) {
    if (decision.status !== 'pending') continue;
    const gatedByTarget = fenced.edges.some(
      (edge) =>
        edge.kind === 'leads_to' &&
        edge.targetNodeId === decision.nodeId &&
        targetIds.has(edge.sourceNodeId),
    );
    if (gatedByTarget) {
      await ctx.graphModel.cancelDecision(goalId, decision.id, 'Superseded by node retirement');
    }
  }

  // Reopen a goal the coordinator parked because of what was just retired:
  // `review` held by the retired node's gate, or `paused` by `no_frontier`
  // (the stray branch left nothing runnable). A pause somebody chose — or
  // one the coordinator took for another reason, like a budget — is left.
  const after = await ctx.requireGraph(goalId);
  const lastTransition = after.events.find((event) => event.entityType === 'goal');
  const parkedOnNoFrontier =
    after.goal.status === 'paused' &&
    !after.goal.config?.pausedBy &&
    lastTransition?.actorType !== 'user' &&
    lastTransition?.reason === NO_FRONTIER_PAUSE_REASON;
  if (after.goal.status === 'review' || parkedOnNoFrontier) {
    const hasPendingDecision = after.decisions.some((decision) => decision.status === 'pending');
    if (!hasPendingDecision) {
      await ctx.transitionStatus(after.goal, 'running', 'nodes retired by user', 'user');
    } else if (parkedOnNoFrontier) {
      await ctx.transitionStatus(after.goal, 'review', 'nodes retired by user', 'user');
    }
  }

  return { retiredNodeIds: targets.map((node) => node.id) };
};

export const setBudget = async (
  ctx: GoalServiceContext,
  goalId: string,
  budget: {
    deadline?: string | null;
    maxAttemptsPerTask?: number;
    maxConcurrentTasks?: number | null;
    maxExperiments?: number;
    maxManagerTurns?: number;
    maxRounds?: number | null;
    maxStepsPerRun?: number | null;
    maxTotalCost?: number | null;
  },
) => {
  const before = await ctx.requireGraph(goalId);
  const wasBinding = await ctx.evaluateBudget(before.goal, before);
  const managerTurnsWereSpent = managerTurnsSpent(before.goal.config);

  // Deadline joins the two execution budgets on the goal row's config; null
  // clears it, and omitting it leaves it alone — the cost/round editor sends
  // only what it owns, and must not silently drop a deadline someone set.
  // The merge keeps an untouched recovery/schedule block intact.
  const config = { ...before.goal.config };
  if (budget.maxExperiments !== undefined) {
    if (
      !config.exploration ||
      !Number.isInteger(budget.maxExperiments) ||
      budget.maxExperiments < 1 ||
      budget.maxExperiments > 200
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'An exploration Goal requires 1–200 experiments',
      });
    }
    config.exploration = { ...config.exploration, maxExperiments: budget.maxExperiments };
  }
  if (budget.deadline !== undefined) {
    config.schedule = { ...config.schedule, deadline: budget.deadline };
  }
  // The limits a goal is created with stay editable: a goal that ran into one
  // must be continued with a higher one, not replaced by a copy of itself.
  if (budget.maxManagerTurns !== undefined) {
    if (!config.manager) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only a Goal with a main Agent has a turn budget',
      });
    }
    config.manager = { ...config.manager, maxTurns: budget.maxManagerTurns };
  }
  if (budget.maxConcurrentTasks !== undefined) {
    config.maxConcurrentTasks = budget.maxConcurrentTasks;
  }
  if (budget.maxAttemptsPerTask !== undefined || budget.maxStepsPerRun !== undefined) {
    config.recovery = {
      ...config.recovery,
      ...(budget.maxAttemptsPerTask !== undefined && {
        maxAttemptsPerTask: budget.maxAttemptsPerTask,
      }),
      ...(budget.maxStepsPerRun !== undefined && { maxStepsPerRun: budget.maxStepsPerRun }),
    };
  }

  const goal = await ctx.goalModel.update(goalId, {
    config,
    maxRounds: budget.maxRounds,
    maxTotalCost: budget.maxTotalCost,
  });
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

  // Raising a budget is how a user un-sticks a goal the coordinator parked on
  // one, and `tick` refuses to move a paused goal — so without this the
  // queued advance would return straight away and the user would have to find
  // Resume as a second gesture. Only a goal the budget actually stopped is
  // reopened: if the old budget was not binding, this pause was somebody's
  // deliberate one and is left alone.
  const stoppedByBudget =
    wasBinding.costLimitReached || wasBinding.roundLimitReached || wasBinding.deadlinePassed;
  const stoppedByExploration = before.goal.config?.pausedBy === 'exploration_limit';
  // The main Agent pauses its goal when its turns run out, and resuming alone
  // pauses it again on the next tick. Raising the cap is what lets it continue.
  const stoppedByManagerTurns = managerTurnsWereSpent && !managerTurnsSpent(goal.config);
  if (
    goal.status !== 'paused' ||
    goal.config?.pausedBy === 'user' ||
    (!stoppedByBudget && !stoppedByExploration && !stoppedByManagerTurns)
  )
    return goal;
  if (
    stoppedByExploration &&
    before.nodes.filter(
      (node) =>
        node.kind === 'task' &&
        node.title !== GOAL_ACCEPTANCE_TASK_TITLE &&
        !isGoalReportNode(before, node),
    ).length >= (goal.config?.exploration?.maxExperiments ?? 0)
  )
    return goal;

  const nowBinding = await ctx.evaluateBudget(goal, before);
  if (nowBinding.costLimitReached || nowBinding.roundLimitReached || nowBinding.deadlinePassed) {
    return goal;
  }

  return (await ctx.resume(goalId)) ?? goal;
};
