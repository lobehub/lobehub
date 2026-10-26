import type { GoalGraphSnapshot, GoalItem, GoalStatus, TaskItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { GoalRepository } from '@/database/repositories/goal';

import { GoalAssignmentService } from '../assignment';
import { GOAL_ACCEPTANCE_TASK_TITLE, TERMINAL_NODE_STATUSES } from '../decideNextMove';
import { GoalManagerService } from '../manager';
import { resolveOperationLeaseTimeout } from '../recoveryPolicy';
import { isGoalReportNode } from '../report';
import { GoalSupervisorService } from '../supervisor';
import type { GoalServiceContext } from './types';
import { goalTaskAgentId } from './utils';

const draftNotStarted = (goalId: string) =>
  new TRPCError({
    code: 'CONFLICT',
    message: `Goal is a draft; start it with lh goal start ${goalId}`,
  });

/**
 * The coordinator calls a goal achieved once its own acceptance passes, but
 * the person who asked for it has not said so yet. Ask them — wherever they
 * are — through the inbox, tied to the Goal-level acceptance they sign.
 */
export const requestSignOff = async (ctx: GoalServiceContext, graph: GoalGraphSnapshot) => {
  const terminal = graph.nodes.find(
    (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE && !!node.taskId,
  );
  if (!terminal) return;
  const acceptance = (await ctx.collectAcceptances(graph))?.[terminal.id];
  if (!acceptance) return;
  // `openSignOff` re-reads the acceptance under a row lock: one the owner
  // already signed asks nothing.
  await ctx.briefs.openSignOff(graph.goal, acceptance.id);
};

/**
 * Stop everything the goal has running, then delete it and its graph.
 *
 * Deleting only the goal row cascades the graph away but leaves each graph
 * Task — and the agent operation behind it — running, spending the user's
 * budget with nothing left on screen to stop it. The tasks themselves stay:
 * they are ordinary tasks with their own history and acceptance.
 */
export const deleteGoal = async (ctx: GoalServiceContext, goalId: string) => {
  let graph = await ctx.graphModel.getGraph(goalId);
  const managed = !!graph?.goal.config?.manager;
  const supervised =
    !!graph?.goal.config?.supervision?.enabled || !!graph?.goal.config?.supervisorState;
  if (managed || supervised) {
    // Fence new claims before cancellation, then read the latest claimed turn.
    await ctx.db.transaction(async (db) => {
      const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
      const current = await model.lockById(goalId);
      if (current && current.status !== 'paused') {
        await model.updateStatus(goalId, 'paused');
        await new GoalGraphModel(db, ctx.userId, ctx.workspaceId).recordGoalStatus(
          goalId,
          current.status,
          'paused',
          'Stopping Goal before deletion',
        );
      }
    });
    graph = await ctx.graphModel.getGraph(goalId);
    if (graph) {
      if (managed) await new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId).stop(graph);
      if (supervised)
        await new GoalSupervisorService(ctx.db, ctx.userId, ctx.workspaceId).stop(graph);
    }
  }
  const taskIds = graph?.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])) ?? [];

  for (const taskId of taskIds) {
    const topics = await ctx.taskTopicModel.findByTaskId(taskId);
    for (const topic of topics) {
      if (topic.status !== 'running' || !topic.topicId) continue;
      // Deliberately not swallowed. Interrupting can fail — the runtime or a
      // device gateway may be unreachable — and going ahead would delete the
      // only surface that can stop an operation which keeps spending. Better
      // to leave the goal intact and say so.
      try {
        await ctx.taskService.cancelTopic(topic.topicId);
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'PRECONDITION_FAILED',
          message:
            'Could not stop the work still running for this goal, so it was not deleted. Try again once the run is reachable.',
        });
      }
    }
    await ctx.taskModel
      .updateStatusIfCurrent(taskId, 'running', 'paused')
      .catch((error) => console.error('[GoalService.delete] failed to pause task:', error));
  }

  if (managed || supervised) {
    return ctx.db.transaction(async (db) => {
      const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
      const current = await model.lockById(goalId);
      if (
        current &&
        (current.status !== 'paused' ||
          current.config?.managerState?.token !== graph?.goal.config?.managerState?.token ||
          current.config?.managerState?.turns !== graph?.goal.config?.managerState?.turns ||
          current.config?.supervisorState?.revision !==
            graph?.goal.config?.supervisorState?.revision)
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Goal changed during cancellation; it was not deleted',
        });
      }
      return model.delete(goalId);
    });
  }
  return ctx.goalModel.delete(goalId);
};

/**
 * Move the goal's lifecycle status and leave an event behind.
 *
 * The row update alone made status changes untraceable: `entityType='goal'`
 * events existed in the schema but nothing wrote them, so a goal's
 * planning → running → paused → achieved path could not be reconstructed
 * from its timeline. Transitions the coordinator makes are filed under the
 * coordinator actor; a person's pause/resume keeps the user attribution the
 * model defaults to — the split that separates what the coordinator decided
 * from what the user asked for relies on.
 *
 * A same-status write is a no-op — re-stamping `running` on every tick that
 * touches a running goal would flood the timeline the way the unbounded
 * event read flooded the payload.
 */
export const transitionStatus = async (
  ctx: GoalServiceContext,
  goal: GoalItem,
  to: GoalStatus,
  reason?: string,
  actor: 'coordinator' | 'user' = 'coordinator',
): Promise<GoalItem | undefined> => {
  if (goal.status === to) return goal;
  const updated = await ctx.goalModel.updateStatus(goal.id, to);
  if (!updated) return undefined;
  const model = actor === 'coordinator' ? ctx.coordinatorGraph : ctx.graphModel;
  await model
    .recordGoalStatus(goal.id, goal.status, to, reason)
    .catch((error) => console.error('[GoalService] failed to record goal status:', error));
  return updated;
};

export const pause = async (ctx: GoalServiceContext, goalId: string) => {
  const graph = await ctx.requireGraph(goalId);
  // A draft never ran; pausing it would let a later resume skip `start`.
  if (graph.goal.status === 'draft') throw draftNotStarted(goalId);
  // From here the pause is the person's, so no later measurement lifts it.
  // Written even when the goal is already paused — that transition is a
  // no-op, so this marker is the only record that the person took it over.
  await ctx.setPauseReason(goalId, 'user');
  const goal = await ctx.transitionStatus(graph.goal, 'paused', 'paused by user', 'user');
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return goal;
};

/**
 * Start every unfinished Task node over: interrupt the run it may still be
 * holding, clear the failure it may be parked on, and return the Task to
 * `backlog` so the next coordinator tick dispatches it afresh. Optionally
 * hands the restarted Tasks to a different agent in the same gesture — the
 * goal's executor slot moves with them: `taskAgentId` when the goal routes
 * work to a dedicated executor, otherwise the goal agent that does its own
 * Tasks. Resolved nodes and their completed Tasks are left untouched.
 */
export const restart = async (
  ctx: GoalServiceContext,
  goalId: string,
  options?: { agentId?: string },
): Promise<{ goal: GoalItem; restartedTaskIds: string[] }> => {
  const graph = await ctx.requireGraph(goalId);
  const assignment = new GoalAssignmentService(ctx.db, ctx.userId, ctx.workspaceId);
  if (options?.agentId) await assignment.assertUsableForGoal(graph.goal, options.agentId);

  const unfinishedNodes = graph.nodes.filter(
    (node) =>
      node.kind === 'task' &&
      !isGoalReportNode(graph, node) &&
      node.taskId &&
      !TERMINAL_NODE_STATUSES.has(node.status),
  );
  const unfinishedNodeIds = new Set(unfinishedNodes.map((node) => node.id));
  const unfinishedTaskIds = unfinishedNodes.flatMap((node) => (node.taskId ? [node.taskId] : []));

  // A restarted task's pending failure gate is answered by the restart
  // itself. Left pending, it would keep winning the coordinator's
  // pending-decision branch and the goal would sit `waiting_human` with
  // every task freshly reset. Gates on untouched nodes keep parking the
  // goal — they ask something this restart does not answer.
  // Gate edges run task-node → decision-node (see openFailureDecision).
  const staleGates = graph.decisions.filter(
    (decision) =>
      decision.status === 'pending' &&
      graph.edges.some(
        (edge) =>
          edge.kind === 'leads_to' &&
          edge.targetNodeId === decision.nodeId &&
          unfinishedNodeIds.has(edge.sourceNodeId),
      ),
  );
  for (const gate of staleGates) {
    await ctx.graphModel.cancelDecision(goalId, gate.id, 'Superseded by goal restart');
  }

  const restartedTaskIds: string[] = [];
  let candidates: TaskItem[] = [];
  if (unfinishedTaskIds.length > 0) {
    const runningTopics = await ctx.taskTopicModel.findRunningByTaskIds(unfinishedTaskIds);
    for (const topic of runningTopics) {
      if (topic.topicId) await ctx.taskService.cancelTopic(topic.topicId);
    }
    // Re-read after the cancels and reset via compare-and-swap: a coordinator
    // tick dispatching concurrently moves the row between our read and the
    // write, the CAS loses, and that task is skipped instead of yanked out
    // from under a freshly claimed run (which would double-dispatch it).
    candidates = (await ctx.taskModel.findByIds(unfinishedTaskIds)).filter(
      (task) => task.status !== 'completed',
    );
    if (!options?.agentId) {
      for (const task of candidates) {
        const reset = await ctx.taskModel.updateStatusIfCurrent(task.id, task.status, 'backlog', {
          error: null,
        });
        if (reset) restartedTaskIds.push(task.id);
      }
    }
  }

  // The handoff lands only after the interrupts succeeded — a cancelTopic
  // failure above must not leave the goal pointing at the new agent while
  // its tasks and live runs still belong to the old one. The Tasks restart
  // onto the new agent inside the handoff's own transaction, so no tick can
  // claim one with the new assignee but the previous executor's model.
  let goal = graph.goal;
  if (options?.agentId) {
    const agentId = options.agentId;
    const handed = await assignment.handOver(
      goalId,
      (model, current) =>
        current.config?.taskAgentId
          ? model.updateTaskAgentId(goalId, agentId)
          : model.update(goalId, { agentId }),
      (scoped, handedGoal, previous) =>
        scoped.restartTasks(
          handedGoal,
          candidates,
          agentId,
          goalTaskAgentId(previous) !== goalTaskAgentId(handedGoal),
        ),
    );
    goal = handed.goal;
    restartedTaskIds.push(...handed.movedTaskIds);
  }

  // A restart is an explicit "start over": a goal parked by a budget stop or
  // a manual pause must begin ticking again without a second gesture.
  if (goal.status === 'paused') {
    goal = (await ctx.resume(goalId)) ?? goal;
  }
  return { goal, restartedTaskIds };
};

export const resume = async (ctx: GoalServiceContext, goalId: string) => {
  const graph = await ctx.requireGraph(goalId);
  const status = graph.decisions.some((decision) => decision.status === 'pending')
    ? 'review'
    : 'running';
  // Compare-and-set under the row lock `close` commits under: a resume that
  // read the goal before a concurrent close ended it must not write its stale
  // `running` over the ended goal, where the close already put interrupted
  // Tasks back to `backlog` and they would dispatch again. Reopening an ended
  // goal still works — that resume reads the ended status itself.
  return ctx.db.transaction(async (tx) => {
    const model = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const current = await model.lockById(goalId);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    // Only `start` launches a draft: it settles the creating run's planning
    // turn and checks who may launch it, which a plain status flip skips.
    if (current.status === 'draft') throw draftNotStarted(goalId);
    if (current.status !== graph.goal.status) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The goal changed while it was being resumed; try again.',
      });
    }
    await model.updatePauseReason(goalId, undefined);
    if (current.status === status) return current;
    const updated = await model.updateStatus(goalId, status);
    await new GoalGraphModel(tx, ctx.userId, ctx.workspaceId)
      .recordGoalStatus(goalId, current.status, status, 'resumed by user')
      .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    return updated ?? current;
  });
};

/**
 * A person ends the goal themselves — declaring it achieved or dropping it.
 *
 * Everything still spending on the goal is interrupted first — the main
 * Agent's planning turn, the supervisor's diagnosis and every Task run — the
 * same way `delete` does, because a terminal status alone only stops the
 * coordinator from dispatching more. Reopening goes through `resume`, which
 * accepts any status.
 */
export const close = async (
  ctx: GoalServiceContext,
  goalId: string,
  to: 'achieved' | 'canceled',
) => {
  // Fence new claims before scanning: `dispatchWork` claims under this row
  // lock and only while the goal reads `running`, so an advance overlapping
  // the close cannot start a Task after the scan below. The pause is the
  // person's, so no measurement lifts it if the close is refused later on.
  await ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
    const current = await model.lockById(goalId);
    // Only a goal that can still dispatch needs fencing.
    if (!current || ['paused', 'achieved', 'failed', 'canceled'].includes(current.status)) return;
    await model.updateStatus(goalId, 'paused');
    await model.updatePauseReason(goalId, 'user');
    await new GoalGraphModel(db, ctx.userId, ctx.workspaceId).recordGoalStatus(
      goalId,
      current.status,
      'paused',
      'Stopping Goal before closing',
    );
  });
  const graph = await ctx.requireGraph(goalId);

  // Deliberately not swallowed, as in `delete`: an operation whose exit is
  // unconfirmed keeps spending, and a goal reading "ended" would hide it. The
  // goal stays paused so nothing new starts, and the person can retry.
  const notClosed = (error: unknown) =>
    new TRPCError({
      cause: error,
      code: 'PRECONDITION_FAILED',
      message:
        'Could not stop the work still running for this goal, so it was not closed. Try again once the run is reachable.',
    });
  try {
    if (graph.goal.config?.manager)
      await new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId).stop(graph);
    if (graph.goal.config?.supervision?.enabled || graph.goal.config?.supervisorState)
      await new GoalSupervisorService(ctx.db, ctx.userId, ctx.workspaceId).stop(graph);
  } catch (error) {
    throw notClosed(error);
  }

  const unfinishedTaskIds = graph.nodes.flatMap((node) =>
    node.kind === 'task' && node.taskId && !TERMINAL_NODE_STATUSES.has(node.status)
      ? [node.taskId]
      : [],
  );
  if (unfinishedTaskIds.length > 0) {
    // Claims whose run has not been recorded yet. `dispatchWork` marks the
    // Task `running` before `runTask` records the topic, so the scan below
    // cannot see that run, and only a recorded run can be interrupted with
    // confirmation. A fresh claim therefore refuses the close: the goal stays
    // fenced, and a retry a moment later finds the run recorded and stops it
    // the confirmed way. A claim older than the operation lease is one whose
    // startup died; it is withdrawn to `backlog` under the task row lock the
    // recording also takes, so a straggler recording stops its own run.
    const staleBefore = Date.now() - resolveOperationLeaseTimeout(graph.goal);
    let starting = false;
    for (const taskId of unfinishedTaskIds) {
      await ctx.db.transaction(async (tx) => {
        const taskModel = new TaskModel(tx, ctx.userId, ctx.workspaceId);
        if (!(await taskModel.lockForUpdate(taskId))) return;
        const task = await taskModel.findById(taskId);
        if (task?.status !== 'running') return;
        const recorded = await new TaskTopicModel(
          tx,
          ctx.userId,
          ctx.workspaceId,
        ).findRunningByTaskIds([taskId]);
        if (recorded.length > 0) return;
        if (task.updatedAt.getTime() > staleBefore) {
          starting = true;
          return;
        }
        await taskModel.updateStatusIfCurrent(taskId, 'running', 'backlog', { error: null });
      });
    }
    if (starting)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'A run for this goal is still starting, so it was not closed. No new work will start; try again in a moment.',
      });

    const runningTopics = await ctx.taskTopicModel.findRunningByTaskIds(unfinishedTaskIds);
    for (const topic of runningTopics) {
      if (!topic.topicId) continue;
      try {
        await ctx.taskService.cancelTopic(topic.topicId);
      } catch (error) {
        throw notClosed(error);
      }
      // Reset right after its own interruption, as in `restart`: left `paused`
      // it reads as parked on a person and a reopened goal waits on it. Doing
      // it per run means a later failed interruption cannot strand the ones
      // already stopped — a retry no longer sees them as running. CAS so a
      // row a concurrent tick just moved is never yanked.
      const task = await ctx.taskModel.findById(topic.taskId);
      if (task && task.status !== 'completed') {
        await ctx.taskModel.updateStatusIfCurrent(task.id, task.status, 'backlog', {
          error: null,
        });
      }
    }
  }
  // Commit under the same lock the fence took, and only if the fence still
  // holds: a resume from another tab during the interruption pass lets an
  // advance claim work this pass never saw, and ending the goal over it
  // would leave that run spending on a goal reading "ended".
  const reason = to === 'achieved' ? 'marked achieved by user' : 'canceled by user';
  const goal = await ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
    const current = await model.lockById(goalId);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    if (!['paused', 'achieved', 'failed', 'canceled'].includes(current.status)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The goal was resumed while it was being closed, so it was not closed.',
      });
    }
    await model.updatePauseReason(goalId, undefined);
    if (current.status === to) return current;
    const updated = await model.updateStatus(goalId, to);
    await new GoalGraphModel(db, ctx.userId, ctx.workspaceId)
      .recordGoalStatus(goalId, current.status, to, reason)
      .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    return updated;
  });
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  return goal;
};
