import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import {
  GOAL_BATCH_BREAK_OPTION,
  GOAL_BATCH_RELEASE_OPTION,
  GOAL_CLARIFICATION_OPTION,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_MACHINE_GATE_TITLE,
} from '@lobechat/const/goal';
import type {
  GoalDecisionOption,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalManagerAsk,
  GoalTickResult,
} from '@lobechat/types';
import { experimentOwner } from '@lobechat/utils/goalGraph';
import { TRPCError } from '@trpc/server';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { GoalRepository } from '@/database/repositories/goal';

import { collectStrandedDependents, GOAL_ACCEPTANCE_TASK_TITLE } from '../decideNextMove';
import { answeredProblem, GoalManagerService, problemKey } from '../manager';
import { GoalSupervisorService } from '../supervisor';
import type { GoalServiceContext } from './types';
import { GOAL_ENDED_STATUSES } from './utils';

/** A Goal whose delivery the owner can still send back for rework. */
const REOPENABLE_GOAL_STATUSES = new Set(['achieved', 'running']);

/**
 * What answering a gate does to the Task it was opened for. The coordinator's
 * own options say it through their fixed ids; an option the main Agent wrote
 * for its own question names its effect, and one that names none only records
 * the answer — the Agent reads it on its next turn.
 */
const decisionOptionEffect = (
  option: GoalDecisionOption | undefined,
  sourceTitle?: string,
): 'fail' | 'retire' | 'retry' | undefined => {
  if (!option) return undefined;
  if (option.effect) return option.effect;
  if (option.id === 'retry' || option.id === 'retire') return option.id;
  if (option.id === 'fail' && sourceTitle === GOAL_ACCEPTANCE_TASK_TITLE) return 'fail';
  return undefined;
};

/**
 * Put on every option that retires the task what it would take along: the
 * unfinished tasks that wait on it. The Retire button says so, and an option
 * the main Agent wrote for its own question carries it the same way.
 */
const withRetireCascade = (
  options: GoalDecisionOption[],
  sourceTitle: string | undefined,
  stranded: GoalGraphNode[],
): GoalDecisionOption[] =>
  options.map((option) => {
    if (decisionOptionEffect(option, sourceTitle) !== 'retire') return option;
    const { alsoRetires: _previous, ...rest } = option;
    return stranded.length > 0
      ? { ...rest, alsoRetires: stranded.map((node) => ({ nodeId: node.id, title: node.title })) }
      : rest;
  });

/** Whether the person was shown exactly the tasks this retire would take along. */
const confirmedCascade = (option: GoalDecisionOption | undefined, stranded: GoalGraphNode[]) => {
  const confirmed = new Set(option?.alsoRetires?.map((item) => item.nodeId) ?? []);
  return confirmed.size === stranded.length && stranded.every((node) => confirmed.has(node.id));
};

/**
 * The comment a retried Task carries into its next attempt. A bare "retry"
 * adds nothing the run does not already know; a chosen direction or a note is
 * exactly what the owner wants the next attempt to act on.
 */
const decisionGuidance = (
  question: string,
  option: GoalDecisionOption | undefined,
  note?: string,
): string | undefined => {
  const custom = option && option.id !== 'retry' ? option : undefined;
  const trimmed = note?.trim();
  if (!custom && !trimmed) return undefined;
  return [
    'Owner decision on the recovery gate for this Task.',
    `Question: ${question}`,
    custom
      ? `Chosen: ${custom.label}${custom.description ? ` — ${custom.description}` : ''}`
      : undefined,
    trimmed ? `Guidance: ${trimmed}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
};

interface FailureGateOptions {
  /** The main Agent's own question for this gate, asked as written with its diagnosis. */
  ask?: GoalManagerAsk & { diagnosis: string };
  /**
   * The gate is about a machine problem (broken setup, spent retry schedule), not
   * the work: it opens as a machine gate that asks for a fix, not a judgment.
   */
  machine?: boolean;
}

export const decide = async (
  ctx: GoalServiceContext,
  goalId: string,
  decisionId: string,
  optionId: string,
  resolution?: string,
  options?: { fromReleaseGate?: boolean },
) => {
  const graph = await ctx.requireGraph(goalId);
  // A goal a person ended stays ended: a gate another tab still shows must
  // not reopen it. Checked again under the lock before the status moves.
  if (GOAL_ENDED_STATUSES.has(graph.goal.status)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'This goal has ended' });
  }
  const decision = graph.decisions.find((item) => item.id === decisionId);
  if (!decision || decision.status !== 'pending') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending decision not found' });
  }
  if (decision.options?.length && !decision.options.some((option) => option.id === optionId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown decision option' });
  }
  // A held release with a review page is decided there, with its evidence —
  // not by a one-click answer from a surface that never showed it.
  const heldRelease = graph.goal.config?.rolloutState;
  if (
    !options?.fromReleaseGate &&
    heldRelease?.releaseGateAcceptanceId &&
    heldRelease.releaseReviewNodeId === decision.nodeId
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This release is decided on its review page',
    });
  }
  // The note *is* the answer for this option; an empty one would re-plan the
  // goal on nothing and the question could never be asked again.
  if (optionId === GOAL_CLARIFICATION_OPTION.answer && !resolution?.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This answer needs a note' });
  }
  // Revising a batch recipe without a correction would re-run the plan that
  // just failed under a new version number. The correction is the revision.
  if (optionId === GOAL_BATCH_BREAK_OPTION.revise && !resolution?.trim()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Revising the recipe needs a correction',
    });
  }
  const chosen = decision.options?.find((option) => option.id === optionId);
  const incoming = graph.edges.find(
    (edge) => edge.targetNodeId === decision.nodeId && edge.kind === 'leads_to',
  );
  const source = incoming && graph.nodes.find((node) => node.id === incoming.sourceNodeId);
  // Retiring takes the unfinished dependents along, so the answer only stands
  // for the set the person was shown. A dependent added while the gate waited,
  // or an option that never listed them, gets the gate rewritten and asked
  // again instead of quietly canceling work nobody confirmed.
  const stranded =
    source?.kind === 'task' &&
    source.title !== GOAL_ACCEPTANCE_TASK_TITLE &&
    decisionOptionEffect(chosen, source.title) === 'retire'
      ? collectStrandedDependents(graph, [source.id])
      : [];
  if (stranded.length > 0 && !confirmedCascade(chosen, stranded)) {
    await ctx.graphModel.updatePendingDecisionOptions(
      goalId,
      decisionId,
      withRetireCascade(decision.options ?? [], source?.title, stranded),
    );
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The tasks this retire would take along changed; review the updated choice',
    });
  }
  // R5: a person answering a batch gate IS the intervention, and an
  // intervention rolls the class back to canary. Open the next recipe round
  // automatically — revise the same mould, or fork it as a new class — rather
  // than leaving the goal parked for someone to rerun by hand. The gate hangs
  // on the Assay (materialized on demand for a `full` rollout), so match that,
  // falling back to the batch node for any gate opened elsewhere. The restart
  // consumes the answer itself, atomically with the round it opens.
  const rolloutState = graph.goal.config?.rolloutState;
  const batchGateNodeId =
    rolloutState?.phase === 'release_review'
      ? rolloutState.releaseReviewNodeId
      : rolloutState?.phase === 'pattern_break'
        ? (rolloutState.assayNodeId ?? rolloutState.batchNodeId)
        : undefined;
  const answersBatchGate = batchGateNodeId !== undefined && decision.nodeId === batchGateNodeId;
  // A held release keeps its round either way: approving sends the wave out on
  // the proven plan, sending it back has the main Agent rewrite that plan.
  const resolved = !answersBatchGate
    ? await ctx.graphModel.resolveDecision(goalId, decisionId, optionId, resolution)
    : rolloutState?.phase !== 'release_review'
      ? await ctx.restartRolloutLoop(goalId, decisionId, optionId, resolution)
      : optionId === GOAL_BATCH_RELEASE_OPTION.release
        ? await ctx.releaseReview.approveRolloutRelease(goalId, decisionId, optionId, resolution)
        : // A release sent back goes to the main Agent, whoever answered it.
          await ctx.releaseReview.sendRevisionToAgent(
            goalId,
            decision.nodeId,
            decisionId,
            resolution,
          );
  if (!resolved)
    throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });

  if (source?.kind === 'task') {
    if (source.taskId)
      await new GoalSupervisorService(ctx.db, ctx.userId, ctx.workspaceId).recordProgress(
        graph,
        source.taskId,
        true,
      );
    const effect = decisionOptionEffect(chosen, source.title);
    if (effect === 'retry' && source.taskId) {
      await ctx.taskModel.updateStatus(source.taskId, 'backlog', { error: null });
      await ctx.graphModel.updateNodeStatus(goalId, source.id, 'active', resolution);
      // The note is guidance for the next attempt, so it goes where that
      // attempt reads: the Task's comments are part of every run prompt.
      // On the node status alone it was recorded and never read again.
      const guidance = decisionGuidance(decision.question, chosen, resolution);
      if (guidance)
        await ctx.taskModel.addComment({
          authorUserId: ctx.userId,
          content: guidance,
          taskId: source.taskId,
          userId: ctx.userId,
        });
    } else if (effect === 'retire') {
      await ctx.graphModel.updateNodeStatus(goalId, source.id, 'retired', resolution);
      // Same rule `retireNodes` enforces: whatever still waits on the retired
      // node leaves with it, or it would block the goal on a prerequisite
      // that can no longer resolve. This is the set confirmed above.
      for (const node of stranded) {
        await ctx.graphModel.updateNodeStatus(
          goalId,
          node.id,
          'retired',
          `Retired with its prerequisite "${source.title}"`,
        );
      }
      if (stranded.length > 0)
        await ctx.stopFencedTasks(goalId, new Set(stranded.map((node) => node.id)));
    }
  }
  // Ending the terminal acceptance ends the Goal: `fail` is a verdict that
  // the Goal failed, `retire` abandons it without one.
  const terminalAcceptance = source?.title === GOAL_ACCEPTANCE_TASK_TITLE;
  const terminalEffect = decisionOptionEffect(chosen, source?.title);
  const nextStatus =
    terminalAcceptance && terminalEffect === 'fail'
      ? 'failed'
      : terminalAcceptance && terminalEffect === 'retire'
        ? 'canceled'
        : 'running';
  // Serialized with `close`, which commits under this row lock: a goal that
  // ended while this answer was being written is left ended.
  await ctx.db.transaction(async (tx) => {
    const current = await new GoalRepository(tx, ctx.userId, ctx.workspaceId).lockById(goalId);
    if (!current || GOAL_ENDED_STATUSES.has(current.status)) return;
    if (current.status === nextStatus) return;
    await new GoalRepository(tx, ctx.userId, ctx.workspaceId).updateStatus(goalId, nextStatus);
    await new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    })
      .recordGoalStatus(
        goalId,
        current.status,
        nextStatus,
        `decision "${decision.question}" resolved: ${optionId}`,
      )
      .catch((error) => console.error('[GoalService] failed to record goal status:', error));
  });
  return resolved;
};

/**
 * The owner sent the Goal's delivery back (提出修改 on the Goal-level
 * acceptance). The acceptance passing is what ended the Goal, so without a
 * reopen the coordinator reads it as still achieved and nothing reworks it.
 * The acceptance Task goes back to the queue — its next attempt reads the
 * rejected round's comment through the prompt builder — and the Goal runs
 * again. When that attempt is accepted the Goal is achieved anew, and the
 * wrap-up writes a new report version for the new result.
 *
 * Returns the reopened Goal id, or undefined when `taskId` is not a settled
 * Goal-level acceptance of a Goal that can still be reworked; a stopped Goal
 * is continued from its result, not reopened by a sign-off.
 */
export const reopenForChanges = async (
  ctx: GoalServiceContext,
  taskId: string,
  comment?: string,
): Promise<string | undefined> => {
  const goal = await ctx.goalModel.findByGraphTask(taskId);
  if (!goal || !REOPENABLE_GOAL_STATUSES.has(goal.status)) return undefined;
  const graph = await ctx.requireGraph(goal.id);
  const node = graph.nodes.find(
    (candidate) =>
      candidate.kind === 'task' &&
      candidate.taskId === taskId &&
      candidate.title === GOAL_ACCEPTANCE_TASK_TITLE,
  );
  if (node?.status !== 'resolved') return undefined;

  const reason = comment ? `Changes requested: ${comment}` : 'Changes requested';
  await ctx.taskModel.updateStatus(taskId, 'backlog', { error: null });
  await ctx.graphModel.updateNodeStatus(goal.id, node.id, 'active', reason);
  await ctx.goalModel.update(goal.id, {
    config: {
      ...graph.goal.config,
      changeRequest: {
        ...(comment ? { comment } : {}),
        requestedAt: new Date().toISOString(),
        taskId,
      },
    },
  });
  await ctx.transitionStatus(graph.goal, 'running', reason, 'user');
  return goal.id;
};

/**
 * Answer a goal's clarification round in one go. Each answer resolves like a
 * single `decide`; the caller schedules one advance afterwards, so the
 * re-plan sees every answer instead of running after the first.
 */
export const answerClarifications = async (
  ctx: GoalServiceContext,
  goalId: string,
  answers: Array<{ decisionId: string; optionId: string; resolution?: string }>,
) => {
  const graph = await ctx.requireGraph(goalId);
  const decisions = new Map(graph.decisions.map((decision) => [decision.id, decision]));

  // Check the whole round before writing any of it: one bad answer used to
  // leave the ones before it resolved, and the client's retry then failed on
  // those. An answer already recorded as given is a retry, not a conflict.
  const toResolve = answers.filter((answer) => {
    const decision = decisions.get(answer.decisionId);
    if (!decision) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending decision not found' });
    }
    if (decision.status === 'resolved' && decision.resolvedOptionId === answer.optionId) {
      return false;
    }
    if (decision.status !== 'pending') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });
    }
    if (decision.options?.length && !decision.options.some((o) => o.id === answer.optionId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown decision option' });
    }
    if (answer.optionId === GOAL_CLARIFICATION_OPTION.answer && !answer.resolution?.trim()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This answer needs a note' });
    }
    return true;
  });

  for (const answer of toResolve) {
    await ctx.decide(goalId, answer.decisionId, answer.optionId, answer.resolution);
  }
};

/**
 * Every stop-on-a-person funnels through here, so this is the one place a main
 * Agent can be offered the problem before the Goal parks on its owner.
 *
 * The coordinator only reaches this point once its own policy is out of moves:
 * the failure matched no recovery branch, the attempt budget ran out, or the
 * reason is one it cannot classify. That is precisely the class of problem the
 * deterministic lane cannot express, so it is handed over rather than escalated.
 * A main Agent that cannot help answers `escalate`, and the gate opens anyway —
 * one turn later, with a diagnosis attached.
 */
export const gateOrTakeOver = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  taskId: string,
  reason: string,
  effects: GoalAdvanceEffect[] = [],
  gate: FailureGateOptions = {},
): Promise<GoalTickResult> => {
  const takeover = await new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId).takeOver(
    graph,
    { reason, taskId },
  );
  if (takeover) return takeover;
  // When the main Agent already looked at THIS problem, the gate carries what it
  // said: the person answering should see the Agent's reasoning, not just the
  // coordinator's own reason for stopping.
  const answered = answeredProblem(graph.goal.config?.managerState);
  const own = answered?.key === problemKey({ reason, taskId }) ? answered : undefined;
  // An Agent that asked a real question gets it asked as written, with its
  // own answers as the buttons; its diagnosis is what the gate stands on.
  if (own?.ask)
    return ctx.openFailureDecision(graph, nodeId, taskId, reason, effects, {
      ...gate,
      ask: { ...own.ask, diagnosis: own.reason },
    });
  const diagnosis = own ? own.reason.slice(0, 600) : undefined;
  return ctx.openFailureDecision(
    graph,
    nodeId,
    taskId,
    diagnosis ? `${reason} — main Agent: ${diagnosis}` : reason,
    effects,
    gate,
  );
};

export const openFailureDecision = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  taskId: string,
  reason: string,
  effects: GoalAdvanceEffect[] = [],
  gate: FailureGateOptions = {},
): Promise<GoalTickResult> => {
  return ctx.db.transaction(async (tx) => {
    const currentGoal = await new GoalRepository(tx, ctx.userId, ctx.workspaceId).lockById(
      graph.goal.id,
    );
    const service = ctx.inTransaction(tx);
    const current = await service.requireGraph(graph.goal.id);
    if (!currentGoal || ['paused', 'canceled', 'failed', 'achieved'].includes(currentGoal.status)) {
      return {
        goalId: graph.goal.id,
        message: 'Goal was stopped while recovery was being evaluated',
        outcome: 'no_progress',
        taskId,
      };
    }
    const task = await new TaskModel(tx, ctx.userId, ctx.workspaceId).findById(taskId);
    if (task && ['running', 'backlog', 'completed'].includes(task.status)) {
      return {
        goalId: graph.goal.id,
        message: 'Task state changed while recovery was being evaluated',
        outcome: 'waiting_external',
        taskId,
      };
    }
    return service.openFailureDecisionLocked(current, nodeId, taskId, reason, effects, gate);
  });
};

export const openFailureDecisionLocked = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  taskId: string,
  reason: string,
  effects: GoalAdvanceEffect[],
  gate: FailureGateOptions = {},
): Promise<GoalTickResult> => {
  const existingDecisionNode = graph.edges
    .filter((edge) => edge.sourceNodeId === nodeId && edge.kind === 'leads_to')
    .map((edge) => graph.nodes.find((node) => node.id === edge.targetNodeId))
    .find((node) => node?.kind === 'decision' && node.status !== 'resolved');
  if (!existingDecisionNode) {
    const terminalAcceptance =
      graph.nodes.find((candidate) => candidate.id === nodeId)?.title ===
      GOAL_ACCEPTANCE_TASK_TITLE;
    // The terminal acceptance gate keeps its own three-way shape: ending the
    // Goal is a verdict even when a machine problem is what stopped it.
    const machine = !!gate.machine && !terminalAcceptance;
    const { ask } = gate;
    // Retiring this node retires what waits on it too. The tasks travel as
    // data so the page can say so in the reader's language.
    const source = graph.nodes.find((candidate) => candidate.id === nodeId);
    const stranded = terminalAcceptance ? [] : collectStrandedDependents(graph, [nodeId]);
    const retireTask = withRetireCascade(
      [{ id: 'retire', label: 'Retire task' }],
      source?.title,
      stranded,
    )[0];
    const node = await ctx.coordinatorGraph.createNode(graph.goal.id, {
      // What the gate stands on: the main Agent's diagnosis when it asked,
      // else the coordinator's own reason for stopping.
      description: ask ? `${reason}\n\n${ask.diagnosis}` : reason,
      kind: 'decision',
      status: 'waiting',
      title: machine ? GOAL_MACHINE_GATE_TITLE : 'Choose how to recover failed task',
      scopeId: experimentOwner(graph, nodeId),
    });
    if (node) {
      effects.push({ detail: reason, nodeId, targetId: node.id, type: 'opened_decision' });
      await ctx.coordinatorGraph.createEdge(graph.goal.id, nodeId, node.id, 'leads_to');
      const decision = await ctx.coordinatorGraph.createDecision(
        graph.goal.id,
        node.id,
        ask
          ? {
              authority: 'user',
              options: withRetireCascade(ask.options, source?.title, stranded),
              question: ask.question,
              recommendedOptionId: ask.recommendedOptionId,
              requestedUserId: ctx.userId,
            }
          : {
              authority: 'user',
              options: machine
                ? [{ id: 'retry', label: 'I fixed it — retry' }, retireTask]
                : terminalAcceptance
                  ? [
                      { id: 'retry', label: 'Retry goal acceptance' },
                      // Drop the acceptance Task and end the Goal without a verdict —
                      // unlike `fail`, which records that the Goal was judged failed.
                      { id: 'retire', label: 'Abandon goal acceptance' },
                      { id: 'fail', label: 'Fail goal' },
                    ]
                  : [{ id: 'retry', label: 'Retry task' }, retireTask],
              question: machine
                ? `${reason}. Fix it, then retry or retire this task node?`
                : terminalAcceptance
                  ? `${reason}. Retry Goal acceptance, abandon it, or fail this Goal?`
                  : `${reason}. Retry or retire this task node?`,
              recommendedOptionId: 'retry',
              requestedUserId: ctx.userId,
            },
      );
      if (decision)
        await ctx.briefs.openDecision(graph.goal, {
          decisionId: decision.id,
          options: decision.options,
          question: decision.question,
          recommendedOptionId: decision.recommendedOptionId,
        });
    }
  }
  await ctx.coordinatorGraph.updateNodeStatus(graph.goal.id, nodeId, 'waiting', reason);
  await ctx.transitionStatus(graph.goal, 'review', reason);
  return {
    goalId: graph.goal.id,
    message: 'Task failed; a human decision gate was opened',
    nodeId,
    outcome: 'waiting_human',
    taskId,
  };
};
