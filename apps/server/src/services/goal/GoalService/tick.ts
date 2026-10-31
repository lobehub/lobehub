import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import type { GoalTickResult } from '@lobechat/types';

import {
  decideNextMove,
  frontierNeedsBudget,
  needsMetricCriteria,
  NO_FRONTIER_PAUSE_REASON,
  selectFrontier,
} from '../decideNextMove';
import { exploreGraph } from '../exploreGraph';
import { classifyGoalFailure, isMachineFailureClass } from '../failureClass';
import { GoalManagerService } from '../manager';
import { GoalProbeDistill, needsProbeDistill } from '../probeDistill';
import { resolveMaxConcurrentTasks } from '../recoveryPolicy';
import { withoutGoalReport } from '../report';
import { GoalReportService } from '../reportService';
import { GoalSubscriptionService } from '../subscriptions';
import { GoalSupervisorService } from '../supervisor';
import {
  type GoalTickOptions,
  toBudgetState,
  toFrontierTaskState,
  toTraceGraphState,
} from '../traceObservation';
import type { GoalServiceContext } from './types';

/**
 * Tick outcomes after which the Goal-level acceptance may have just ended: the
 * Goal was achieved, failed or canceled, or parked on a gate (an acceptance
 * whose attempts ran out opens one). Every other outcome skips the check.
 */
const REPORT_CHECK_OUTCOMES = new Set<GoalTickResult['outcome']>([
  'achieved',
  'failed',
  'waiting_human',
]);

/**
 * Advance the goal by one coordinator step.
 *
 * Choosing and doing are separate: `decideNextMove` is a pure function of the
 * graph, the responsible task and the budget, and everything under the switch
 * only carries that choice out. `onDecision` then receives both what the
 * coordinator read and what it did — the decision surface a goal trajectory
 * records. It travels on that side channel rather than on `GoalTickResult`
 * because the result crosses tRPC to the client and the graph payload is
 * large, the same reason the context engine snapshot stays off the agent
 * runtime's event array.
 */
export const tick = async (
  ctx: GoalServiceContext,
  goalId: string,
  options?: GoalTickOptions,
): Promise<GoalTickResult> => {
  const result = await ctx.tickOnce(goalId, options);
  if (REPORT_CHECK_OUTCOMES.has(result.outcome)) await ctx.dispatchGoalReport(goalId);
  return result;
};

/**
 * The wrap-up branch. Runs after the move rather than as one: it only fires
 * once the Goal-level acceptance has ended, and whatever happens to it — a
 * dispatch that throws, a run that fails or times out — must not change the
 * outcome the coordinator just reported or the Goal's status.
 */
export const dispatchGoalReport = async (ctx: GoalServiceContext, goalId: string) => {
  try {
    await new GoalReportService(ctx.db, ctx.userId, ctx.workspaceId).dispatchIfDue(goalId);
  } catch (error) {
    console.error('[GoalService] wrap-up report dispatch failed:', error);
  }
};

export const tickOnce = async (
  ctx: GoalServiceContext,
  goalId: string,
  options?: GoalTickOptions,
): Promise<GoalTickResult> => {
  const at = Date.now();
  // The coordinator never sees the wrap-up report node: it runs after the
  // Goal-level acceptance and does not take part in the Goal's status.
  let graph = withoutGoalReport(await ctx.requireGraph(goalId));
  // A draft is still being arranged; only `start` hands it to the coordinator.
  if (graph.goal.status === 'draft')
    return {
      goalId,
      message: `Goal is a draft; start it with lh goal start ${goalId}`,
      outcome: 'no_progress',
    };
  // An unmanaged Goal consumes its subscriptions' pending wakes here; a managed
  // one hands them to its planner's turn.
  if (!graph.goal.config?.manager)
    await new GoalSubscriptionService(ctx.db, ctx.userId, ctx.workspaceId).acknowledge(goalId);
  if (graph.goal.config?.manager) {
    // The system's own planner leads whenever the Goal has one: a main Agent is
    // the fallback for problems that planner cannot express, not a replacement
    // for it. With exploration configured this call only settles a turn already
    // in flight; new turns start from `gateOrTakeOver` below, where the
    // coordinator has run out of moves. A Goal whose only planner is the main
    // Agent keeps being led by it.
    const result = await new GoalManagerService(ctx.db, ctx.userId, ctx.workspaceId).advance(
      graph,
      { mayStartTurn: !graph.goal.config.exploration },
    );
    if (result) return result;
  }
  // A plan the owner sent back waits on the main Agent's rewrite, not on the
  // frontier: every probe has settled and nothing else is ready to run.
  if (graph.goal.config?.rolloutState?.phase === 'plan_revision')
    return ctx.releaseReview.routeRolloutRevision(graph);
  // Settled probes teach the plan before the gate judges them: the main Agent
  // rewrites the plan skill from what they ran into. Once it has, this same
  // advance goes on to the gate, on the goal as it now stands.
  if (needsProbeDistill(graph)) {
    const waiting = await new GoalProbeDistill(ctx.db, ctx.userId, ctx.workspaceId).route(graph);
    if (waiting) return waiting;
    graph = withoutGoalReport(await ctx.requireGraph(goalId));
  }

  const frontier = selectFrontier(graph);

  // Every candidate's task, not just the head's: the scheduler has to know
  // which of them are in flight before it can decide what else to start.
  const candidateTaskIds = frontier.eligible.flatMap(({ node }) =>
    node.taskId ? [node.taskId] : [],
  );
  const tasksById = new Map(
    (candidateTaskIds.length > 0 ? await ctx.taskModel.findByIds(candidateTaskIds) : []).map(
      (task) => [task.id, task],
    ),
  );

  // Asked of every unblocked candidate, not just the head: the scheduler
  // walks past a running head to start an independent task, so a head that
  // needs no budget must not decide that nothing does. A goal with nothing
  // startable still skips the query.
  const budget = frontierNeedsBudget(frontier, tasksById)
    ? toBudgetState(graph.goal, await ctx.evaluateBudget(graph.goal, graph))
    : undefined;

  // Same shape as the budget: a database read the pure decision cannot do,
  // taken only in the terminal phase of a goal that declares numeric clauses.
  const metricCriteria = needsMetricCriteria(graph)
    ? await ctx.evaluateMetricCriteria(graph)
    : undefined;

  const concurrency = resolveMaxConcurrentTasks(graph.goal);
  // A repeated batch judges its own gate once the wave it released has fully
  // settled; while a wave is still running the ordinary frontier owns the tick.
  const rolloutGate = ctx.collectRolloutGate(graph);
  const move = decideNextMove({
    budget,
    concurrency,
    frontier,
    graph,
    metricCriteria,
    rolloutGate,
    tasksById,
  });
  // The scheduler may pick past the head of the frontier, so every arm below
  // acts on the node the move chose, which is not necessarily the
  // highest-ranked candidate.
  const acting = move.chosenNodeId
    ? graph.nodes.find((node) => node.id === move.chosenNodeId)
    : undefined;
  const actingTask = acting?.taskId ? (tasksById.get(acting.taskId) ?? null) : undefined;

  const effects: GoalAdvanceEffect[] = [];

  const observe = (result: GoalTickResult): GoalTickResult => {
    options?.onDecision?.({
      at,
      branch: move.branch,
      budget,
      candidates: move.candidates,
      metricCriteria,
      chosenNodeId: move.chosenNodeId,
      effects,
      candidateTasks: frontier.eligible.flatMap(({ node }) => {
        const task = node.taskId ? tasksById.get(node.taskId) : undefined;
        return task ? [toFrontierTaskState(task, node.id)] : [];
      }),
      concurrency,
      graphState: toTraceGraphState(graph),
      message: result.message,
      outcome: result.outcome,
      taskId: result.taskId,
    });
    return result;
  };

  switch (move.branch) {
    case 'goal_paused':
    case 'goal_terminal': {
      return observe({ goalId, message: move.message, outcome: move.outcome });
    }

    case 'pending_decision': {
      await ctx.transitionStatus(graph.goal, 'review', 'a decision gate is open');
      effects.push({ type: 'goal_status', detail: 'review' });
      return observe({
        goalId,
        message: move.message,
        nodeId: move.focusNodeId,
        outcome: move.outcome,
      });
    }

    // Managed Goals reconsider the same contract after a shortfall. Unmanaged
    // Goals park until an observation clears the gate, keeping them out of
    // the sweep while they have no action to take.
    case 'measured_acceptance': {
      const replanning = await new GoalManagerService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).reconsiderAcceptance(graph, move.message);
      if (replanning) return observe(replanning);
      const subscriptions = await new GoalSubscriptionService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).list(goalId);
      if (subscriptions.some((entry) => entry.subscription.enabled)) {
        // A measured shortfall is an observation wait, not a user's pause.
        // The Widget schedule continues, and its durable pending effect or
        // cyclic window scan requests the next coordinator evaluation.
        return observe({ goalId, message: move.message, outcome: 'waiting_external' });
      }
      await ctx.setPauseReason(goalId, 'measured_acceptance');
      await ctx.transitionStatus(graph.goal, 'paused', move.message);
      effects.push({ type: 'goal_status', detail: 'paused' });
      return observe({ goalId, message: move.message, outcome: move.outcome });
    }

    case 'terminal_acceptance': {
      return observe(await ctx.settleTerminalAcceptance(graph, move, effects));
    }

    case 'explore_graph': {
      const spent = await ctx.evaluateBudget(graph.goal, graph);
      if (spent.costLimitReached || spent.roundLimitReached || spent.deadlinePassed) {
        await ctx.transitionStatus(
          graph.goal,
          'paused',
          'Budget exhausted before graph exploration',
        );
        effects.push({ type: 'goal_status', detail: 'paused: budget' });
        return observe({
          goalId,
          outcome: 'no_progress',
          message: 'Budget exhausted before graph exploration',
        });
      }
      return observe(
        await exploreGraph({
          db: ctx.db,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          graph,
          effects,
        }),
      );
    }

    case 'plan_decomposition': {
      return observe(await ctx.planDecomposition(graph, effects));
    }

    case 'rollout_gate': {
      return observe(await ctx.releaseReview.routeRolloutRelease(graph, effects, rolloutGate));
    }

    case 'pattern_break': {
      return observe(
        await ctx.openPatternBreakGate(graph, move.message, effects, { gate: rolloutGate }),
      );
    }

    case 'no_frontier': {
      // Say so on the row instead of leaving a goal that reads as `running`
      // while it cannot run — and, just as importantly, take it out of the
      // sweep's window. A `running` goal that always reports `no_progress` is
      // picked by every scan forever, and enough of them starve every other
      // stalled goal out of the newest-first limit.
      await ctx.transitionStatus(graph.goal, 'paused', NO_FRONTIER_PAUSE_REASON);
      effects.push({ type: 'goal_status', detail: 'paused' });
      return observe({ goalId, message: move.message, outcome: move.outcome });
    }

    case 'create_task': {
      return observe(await ctx.createResponsibleTask(graph, acting!, effects));
    }

    case 'missing_task': {
      await ctx.coordinatorGraph.updateNodeStatus(
        goalId,
        acting!.id,
        'waiting',
        'Responsible task is missing',
      );
      effects.push({ nodeId: acting!.id, type: 'node_status', detail: 'waiting' });
      return observe({
        goalId,
        message: move.message,
        nodeId: acting!.id,
        outcome: move.outcome,
      });
    }

    default: {
      // Everything from here on has a live responsible task.
      const task = actingTask!;
      await ctx.ensureTaskWorkVersion(graph.goal.id, acting!.id, task.id);

      switch (move.branch) {
        case 'consume_completed': {
          return observe(await ctx.consumeCompletedTask(graph, acting!.id, task.id, effects));
        }

        case 'recover_lease': {
          return observe(await ctx.recoverLostRun(graph, acting!.id, task, effects));
        }

        case 'recover_verification': {
          return observe(await ctx.recoverAfterVerification(graph, acting!.id, task, effects));
        }

        case 'failure_decision': {
          // A device that went to sleep or a usage window that closed says
          // nothing about the recipe, for a batch member as for any Task: wait it
          // out first. Checked after the batch gate, one sleeping laptop paused
          // the whole rollout and asked the owner to revise or fork the recipe.
          const waiting =
            (await ctx.waitForDevice(graph, acting!.id, task, effects)) ??
            (await ctx.waitForQuotaReset(graph, acting!.id, task, effects));
          if (waiting) return observe(waiting);
          // R6: a batch member that did not pass its own check IS the same
          // intervention as a blocked gate. Route it through the batch gate so
          // the class rolls back to canary, instead of parking on a standalone
          // task decision that never touches the recipe.
          if (ctx.isBatchMember(graph, acting!.id)) {
            return observe(
              await ctx.openPatternBreakGate(graph, `${acting!.title}: ${move.message}`, effects, {
                unitId: acting!.id,
              }),
            );
          }
          const held = await ctx.holdForMachineFailure(graph, acting!.id, task, effects);
          if (held) return observe(held);
          const supervision = await new GoalSupervisorService(
            ctx.db,
            ctx.userId,
            ctx.workspaceId,
          ).reviewFailure(graph, acting!.id, task);
          if (supervision) return observe(supervision);
          // A machine failure the supervisor gave up on still asks for a fix,
          // not a judgment about the work.
          return observe(
            await ctx.gateOrTakeOver(graph, acting!.id, task.id, move.message, effects, {
              machine: isMachineFailureClass(classifyGoalFailure(task.error).class),
            }),
          );
        }

        case 'task_paused': {
          // R6: a paused batch member (e.g. its delivery did not pass
          // verification) is an intervention on the class, not on one task.
          if (ctx.isBatchMember(graph, acting!.id)) {
            return observe(
              await ctx.openPatternBreakGate(graph, `${acting!.title}: ${move.message}`, effects, {
                unitId: acting!.id,
              }),
            );
          }
          return observe({
            goalId,
            message: move.message,
            nodeId: acting!.id,
            outcome: move.outcome,
            taskId: task.id,
          });
        }

        case 'task_running': {
          if (task.status === 'running') {
            const recovered = await ctx.recoverAbandonedTask(graph, acting!.id, task, effects);
            if (recovered) return observe(recovered);
          }
          return observe({
            goalId,
            message: move.message,
            nodeId: acting!.id,
            outcome: move.outcome,
            taskId: task.id,
          });
        }

        case 'budget_exhausted': {
          await ctx.transitionStatus(graph.goal, 'paused', move.message);
          effects.push({ type: 'goal_status', detail: 'paused' });
          return observe({
            goalId,
            message: move.message,
            nodeId: acting!.id,
            outcome: move.outcome,
            taskId: task.id,
          });
        }

        default: {
          return observe(await ctx.dispatchWork(graph, acting!.id, task, effects));
        }
      }
    }
  }
};
