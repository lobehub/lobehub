import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type {
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
  GoalManagerState,
  GoalPlanContext,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import type { LobeChatDatabase } from '@/database/type';

import { budgetFacts, reviewFeedback } from './planningInputs';
import type { GoalPlan } from './planSchema';
import {
  activeStatuses,
  goalGraph,
  type ManagerContext,
  managerSnapshot,
  terminalNodes,
  turnOperation,
} from './turnState';

/**
 * Why a plan was refused, with the verbatim message this service has thrown
 * since before a diagnosis surface existed.
 *
 * A table rather than literals at each throw site so the write path (`submit`)
 * and the read path (`admission`) cannot drift: both read the same entry, and
 * `lh goal state` turns `code` into a sentence. Several codes share one message
 * on purpose — `submit` has always folded "consumed", "the run ended" and "the
 * graph moved" into a single stale-input refusal, and callers match that text.
 */
export const PLAN_REJECTION = {
  acceptance_escalate_only: {
    message:
      'A failed Goal acceptance can only be escalated; it cannot be superseded by new work yet',
    trpc: 'CONFLICT',
  },
  budget_exhausted: { message: 'Goal budget exhausted', trpc: 'CONFLICT' },
  consumed: { message: 'Stale planning input; no plan applied', trpc: 'CONFLICT' },
  existing_work: {
    message: 'Existing work must be delivered before planning or verification',
    trpc: 'CONFLICT',
  },
  inactive: { message: 'Goal stopped or awaiting human decision', trpc: 'CONFLICT' },
  operation_mismatch: { message: 'Unrelated main Agent operation', trpc: 'FORBIDDEN' },
  pending_decision: { message: 'Goal stopped or awaiting human decision', trpc: 'CONFLICT' },
  release_turn_only: {
    message:
      'This turn was handed a batch release; answer it with release, or escalate (without ask) for the owner to approve it',
    trpc: 'BAD_REQUEST',
  },
  revise_turn_only: {
    message:
      'This turn was handed the batch plan to rewrite; answer it with revise_plan carrying the full revised recipe',
    trpc: 'BAD_REQUEST',
  },
  revise_unsolicited: {
    message:
      'revise_plan only answers a batch plan handed to this turn: one the owner sent back, or one to rewrite from settled probes',
    trpc: 'BAD_REQUEST',
  },
  release_unsolicited: {
    message: 'release only answers a batch release the coordinator handed to this turn',
    trpc: 'BAD_REQUEST',
  },
  review_changed: {
    message:
      'Task review feedback changed; exit without a plan so the next bounded turn can read it',
    trpc: 'CONFLICT',
  },
  stale_input: { message: 'Stale planning input; no plan applied', trpc: 'CONFLICT' },
  started_from_draft: {
    message:
      'The Goal was started with the tasks arranged in its draft, which settled this planning turn; no plan applied',
    trpc: 'CONFLICT',
  },
  turn_owner: { message: 'This planning turn does not own the Goal', trpc: 'FORBIDDEN' },
  turn_settled: { message: 'Stale planning input; no plan applied', trpc: 'CONFLICT' },
  wait_unsettled: { message: 'Settle existing work before waiting', trpc: 'CONFLICT' },
  wait_until_past: { message: 'Wait until must be in the future', trpc: 'BAD_REQUEST' },
} as const satisfies Record<
  string,
  { message: string; trpc: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' }
>;

type PlanRejectionCode = keyof typeof PLAN_REJECTION;

/** A precondition verdict: enough for `submit` to throw it, or for the CLI to explain it. */
export type PlanAdmission =
  | {
      agentId: string;
      code: 'ok';
      graph: GoalGraphSnapshot;
      ok: true;
      opStatus?: string;
      unfinished: GoalGraphNode[];
    }
  | {
      code: 'duplicate';
      ok: true;
      /** Never set here — the duplicate branch returns before the run is resolved. */
      opStatus?: string;
      submitted: NonNullable<GoalManagerState['submitted']>;
    }
  | {
      code: PlanRejectionCode;
      message: string;
      ok: false;
      /** The turn's run status when it was already resolved, so a refusal can still name it. */
      opStatus?: string;
      trpcCode: (typeof PLAN_REJECTION)[PlanRejectionCode]['trpc'];
    };

export const rejectPlan = (code: PlanRejectionCode, opStatus?: string): PlanAdmission => ({
  code,
  message: PLAN_REJECTION[code].message,
  ok: false,
  opStatus,
  trpcCode: PLAN_REJECTION[code].trpc,
});

/**
 * Every precondition a plan has to satisfy, evaluated without writing.
 *
 * `submit` runs this first and throws its verdict; `admission()` returns the
 * same verdict to `lh goal state`. One implementation, so the refusal a caller
 * sees and the reason the CLI prints can never disagree.
 *
 * `token` / `operationId` are optional because the read path asks "would the
 * CURRENT turn's plan apply?" — it has no submitted token to compare, so it
 * passes the recorded one. Guards that only make sense with a plan are skipped
 * when none is supplied.
 */
export const evaluateAdmission = async (
  ctx: ManagerContext,
  db: LobeChatDatabase,
  input: {
    goal: GoalItem;
    operationId?: string;
    plan?: GoalPlan;
    state: GoalManagerState;
    token?: string;
  },
): Promise<PlanAdmission> => {
  const { goal, plan, state } = input;
  if (!goal.config?.manager || !goal.agentId) return rejectPlan('turn_owner');
  if (input.token !== undefined && state.token !== input.token) return rejectPlan('turn_owner');
  // Bound to the goal agent as it is NOW: a turn dispatched before a handoff
  // no longer speaks for the goal.
  const agentId = goal.agentId;
  const op = await turnOperation(new AgentOperationModel(db, ctx.userId, ctx.workspaceId), state);
  if (input.operationId !== undefined) {
    // An adopted local desktop run has no server operation row; it is the run
    // whose id the conversation environment carried when the goal was created.
    const localAdoptedRun = !!state.adopted && !op && input.operationId === state.operationId;
    if (!localAdoptedRun && (op?.id !== input.operationId || op.agentId !== agentId))
      return rejectPlan('operation_mismatch', op?.status);
  }
  const graph = await goalGraph(ctx, db).getGraph(goal.id);
  // A draft takes plans too: the tasks land on the graph it is arranging, and
  // nothing dispatches until the goal is started.
  if (!graph || !(activeStatuses.has(goal.status) || goal.status === 'draft'))
    return rejectPlan('inactive', op?.status);
  if (graph.decisions.some((d) => d.status === 'pending'))
    return rejectPlan('pending_decision', op?.status);
  // That receipt is start's, not a plan: reporting it as a duplicate would
  // tell the agent its plan was recorded when nothing was written.
  if (state.startedFromDraft) return rejectPlan('started_from_draft', op?.status);
  if (state.submitted) return { code: 'duplicate', ok: true, submitted: state.submitted };
  if (state.consumed) return rejectPlan('consumed', op?.status);
  if (op && op.status !== 'running') return rejectPlan('turn_settled', op?.status);
  if (managerSnapshot(graph) !== state.snapshot) return rejectPlan('stale_input', op?.status);
  if (state.reviewSnapshot && (await reviewFeedback(ctx, graph, db)).hash !== state.reviewSnapshot)
    return rejectPlan('review_changed', op?.status);
  if ((await budgetFacts(ctx, graph, db)).blocked)
    return rejectPlan('budget_exhausted', op?.status);
  const unfinished = graph.nodes.filter((n) => n.kind === 'task' && !terminalNodes.has(n.status));
  // A handed-over release has two answers: the Agent releases the wave, or a
  // person approves it. New work or a question with buttons would leave the
  // passed gate with nobody to release it.
  const releaseTurn = state.problemKind === 'rollout_release';
  if (plan?.action === 'release' && !releaseTurn)
    return rejectPlan('release_unsolicited', op?.status);
  if (
    plan &&
    releaseTurn &&
    plan.action !== 'release' &&
    (plan.action !== 'escalate' || plan.ask !== undefined)
  )
    return rejectPlan('release_turn_only', op?.status);
  // A plan the owner sent back, or one the settled probes are to teach, has
  // one answer: the Agent rewrites it. The plan is the Agent's, so nobody else
  // applies the correction or the lessons in its place.
  const reviseTurn =
    state.problemKind === 'rollout_revise' || state.problemKind === 'rollout_distill';
  if (plan?.action === 'revise_plan' && !reviseTurn)
    return rejectPlan('revise_unsolicited', op?.status);
  if (plan && reviseTurn && plan.action !== 'revise_plan')
    return rejectPlan('revise_turn_only', op?.status);
  // A takeover of the terminal acceptance can only be answered with `escalate`.
  // The acceptance task is matched by TITLE regardless of status, so a corrective
  // task returns to that same failed node and `verify` sets `readyForAcceptance`
  // without producing a fresh run — both end at the Gate. Refusing here keeps the
  // prompt's offer and the server's answer the same; letting the acceptance be
  // superseded is a lifecycle change, not a validation one.
  if (
    plan &&
    (plan.action === 'tasks' || plan.action === 'verify') &&
    state.problem &&
    graph.nodes.some(
      (n) =>
        n.kind === 'task' &&
        n.taskId === state.problemTaskId &&
        n.title === GOAL_ACCEPTANCE_TASK_TITLE,
    )
  )
    return rejectPlan('acceptance_escalate_only', op?.status);
  // The unfinished-work guard asks whether an UNINVITED turn may plan while
  // work is in flight; it would double-plan the frontier. A takeover turn
  // inherits work that is stuck by definition — the coordinator only handed it
  // over because nothing else moves it — so a corrective task is the answer
  // rather than the thing to forbid. Without this exemption the prompt
  // advertises four actions and only `escalate` can ever commit.
  if (
    plan &&
    (plan.action === 'tasks' || plan.action === 'verify') &&
    ((unfinished.length && !state.problem) ||
      (plan.action === 'verify' &&
        !graph.nodes.some((n) => n.kind === 'task' && n.status === 'resolved')))
  )
    return rejectPlan('existing_work', op?.status);
  if (plan?.action === 'wait' && unfinished.length) return rejectPlan('wait_unsettled', op?.status);
  if (plan?.action === 'wait' && Date.parse(plan.until) <= Date.now())
    return rejectPlan('wait_until_past', op?.status);
  return { agentId, code: 'ok', graph, ok: true, opStatus: op?.status, unfinished };
};

/**
 * The verdict `submit` would reach right now, plus the facts behind it.
 *
 * Read-only: `lh goal state` renders it and a refused `lh goal plan` re-reads
 * it, so the CLI explains a refusal from these predicates instead of deriving
 * them from a graph that cannot see the manager or review receipts. Token and
 * operation default to the current turn's — the plan a takeover prompt sends.
 *
 * `plan` is forwarded to `evaluateAdmission` because four guards only fire with
 * one (`existing_work`, `acceptance_escalate_only`, `wait_unsettled`,
 * `wait_until_past`). A refused `lh goal plan` passes the plan it just
 * submitted so those refusals are re-derived rather than reported as `ok`;
 * `lh goal state` has no plan and asks only whether the non-plan guards pass.
 */
export const planAdmission = async (
  ctx: ManagerContext,
  goalId: string,
  input: { operationId?: string; plan?: GoalPlan; token?: string } = {},
): Promise<GoalPlanContext> => {
  const goal = await new GoalModel(ctx.db, ctx.userId, ctx.workspaceId).findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  const state = goal.config?.managerState;
  const verdict: PlanAdmission =
    state && goal.config?.manager && goal.agentId
      ? await evaluateAdmission(ctx, ctx.db, {
          goal,
          operationId: input.operationId ?? state.operationId,
          plan: input.plan,
          state,
          token: input.token ?? state.token,
        })
      : rejectPlan('turn_owner');
  const graph =
    verdict.ok && verdict.code === 'ok' ? verdict.graph : await goalGraph(ctx).getGraph(goalId);
  const budget = graph ? await budgetFacts(ctx, graph) : undefined;
  return {
    admission: {
      code: verdict.code,
      ...(verdict.ok ? {} : { message: verdict.message }),
      ok: verdict.ok,
    },
    budget: budget
      ? {
          blocked: budget.blocked,
          deadline: budget.deadline,
          maxRounds: budget.maxRounds,
          maxTotalCost: budget.maxTotalCost,
          runs: budget.runs,
          totalCost: budget.totalCost,
        }
      : undefined,
    goal: { agentId: goal.agentId, pausedBy: goal.config?.pausedBy ?? null, status: goal.status },
    queue: graph
      ? {
          pendingDecisions: graph.decisions.filter((d) => d.status === 'pending').length,
          unfinishedTasks: graph.nodes.filter(
            (n) => n.kind === 'task' && !terminalNodes.has(n.status),
          ).length,
        }
      : undefined,
    review: {
      ...(graph && state ? { current: (await reviewFeedback(ctx, graph)).hash } : {}),
      recorded: state?.reviewSnapshot ?? null,
    },
    snapshot: {
      ...(graph ? { current: managerSnapshot(graph) } : {}),
      recorded: state?.snapshot ?? null,
    },
    turn: state
      ? {
          adopted: !!state.adopted,
          consumed: !!state.consumed,
          dispatchNeverStarted: !!state.dispatchNeverStarted,
          failedTurns: state.failedTurns ?? 0,
          operationId: state.operationId ?? null,
          opStatus: verdict.opStatus ?? null,
          problem: state.problem ?? null,
          problemTaskId: state.problemTaskId ?? null,
          retryAfter: state.retryAfter ?? null,
          startedAt: state.startedAt,
          submitted: state.submitted ?? null,
          token: state.token,
          turns: state.turns,
        }
      : null,
  };
};

/**
 * Authorize a heterogeneous planning read: the caller's operation must be the
 * one the Goal's *current* turn belongs to.
 *
 * The turn is resolved through `turnOperation` — the lookup `submit` uses — not
 * through the `managerState.operationId` receipt. That receipt is written only
 * once the dispatched run's `execAgent` resolves, so a fast run can be live and
 * holding a token before the field exists; and if that save fails the field never
 * arrives, yet the turn is live and `submit` still succeeds. Reading ownership
 * off the same recoverable lookup keeps reads and writes in step.
 */
export const assertOperationOwnsTurn = async (
  ctx: ManagerContext,
  goalId: string,
  operationId: string,
): Promise<void> => {
  const goal = await new GoalModel(ctx.db, ctx.userId, ctx.workspaceId).findById(goalId);
  if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
  const state = goal.config?.managerState;
  const operation = state
    ? await turnOperation(new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId), state)
    : undefined;
  if (operation?.id !== operationId)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This run does not own the current planning turn of this goal',
    });
};
