import { createHash, randomUUID } from 'node:crypto';

import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_CLARIFICATION_OPTION,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_MANAGER_QUESTION_TITLE,
} from '@lobechat/const/goal';
import { buildGoalManagerPrompt } from '@lobechat/prompts';
import type {
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
  GoalManagerState,
  GoalPlanContext,
  GoalTickResult,
  TaskItem,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { TopicTrigger } from '@/const/topic';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { goals } from '@/database/schemas/goal';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { readDeviceDispatchRoute } from '@/server/services/aiAgent/helpers/heteroErrors';
import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';
import { deviceGateway } from '@/server/services/deviceGateway';

import { GoalBriefService } from './goalBriefs';
import { TERMINAL_GOAL_STATUSES as finishedGoalStatuses } from './goalTraceRecorder';
import {
  classifyRunFailure,
  countUnchargedRuns,
  DEFAULT_MANAGER_MAX_TURNS,
  nextDeviceOfflineRetryAt,
  QUOTA_RESET_MARGIN_MS,
  type RunFailure,
} from './recoveryPolicy';
import { scheduleGoalAdvance } from './scheduler';
import { recoveryEligibility } from './supervisor/policy';
import { goalWaitSchema, GoalWaitService } from './wait';

const reason = z.string().trim().min(1).max(8000);
/**
 * The question an escalation puts to the owner. A bare reason left the gate
 * asking "retry or retire?" while the decision that actually blocked the goal —
 * waive a criterion, restore a closed PR — was buried in its text with no
 * button to answer it.
 */
/**
 * Option ids the coordinator and the planner own. Their gates are labelled by
 * id on the goal page and in the inbox, so an authored answer reusing one would
 * show the coordinator's label ("Retry task") over a different consequence.
 */
const RESERVED_ASK_OPTION_IDS = new Set<string>([
  'fail',
  'retire',
  'retry',
  ...Object.values(GOAL_CLARIFICATION_OPTION),
]);

const goalAskSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    options: z
      .array(
        z
          .object({
            id: z
              .string()
              .trim()
              .regex(/^[\w-]{1,40}$/),
            label: z.string().trim().min(1).max(120),
            description: z.string().trim().max(600).optional(),
            effect: z.enum(['retry', 'retire']).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    recommendedOptionId: z.string().trim().optional(),
  })
  .strict()
  .refine((ask) => new Set(ask.options.map((option) => option.id)).size === ask.options.length, {
    message: 'Option ids must be unique',
  })
  .refine((ask) => ask.options.every((option) => !RESERVED_ASK_OPTION_IDS.has(option.id)), {
    message: `Option ids ${[...RESERVED_ASK_OPTION_IDS].join(', ')} are reserved; name the answer itself (e.g. "waive")`,
  })
  .refine(
    (ask) =>
      !ask.recommendedOptionId ||
      ask.options.some((option) => option.id === ask.recommendedOptionId),
    { message: 'recommendedOptionId must name one of the options' },
  );
export const goalPlanSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('tasks'),
      reason,
      tasks: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(255),
            description: reason,
            /**
             * What this task builds on: an existing task node ID from the Goal
             * graph, or the 0-based index of an earlier task in this same plan.
             * Becomes a `depends_on` edge, which both gates dispatch and lays
             * the graph out round by round instead of as one flat row.
             */
            dependsOn: z
              .array(z.union([z.number().int().min(0), z.string().trim().min(1)]))
              .max(20)
              .optional(),
          }),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  z.object({ action: z.literal('verify'), reason }).strict(),
  z.object({ action: z.literal('wait'), reason, ...goalWaitSchema.shape }).strict(),
  z
    .object({
      action: z.literal('retry'),
      reason,
      taskId: z.string().min(1),
      failedOperationId: z.string().min(1),
    })
    .strict(),
  z.object({ action: z.literal('escalate'), reason, ask: goalAskSchema.optional() }).strict(),
]);
type GoalPlan = z.infer<typeof goalPlanSchema>;
const activeStatuses = new Set(['planning', 'running']);
const terminalOperations = new Set(['done', 'error', 'interrupted']);
const terminalNodes = new Set(['resolved', 'retired', 'rejected']);
const TIMEOUT_MS = 20 * 60_000;
/** Task comments listed in one planning turn's message; older ones are counted, not shown. */
const FEEDBACK_NOTE_LIMIT = 20;
/** Source message id prefix of a dispatched planning turn; the suffix is its token. */
const MANAGER_SOURCE_MESSAGE_PREFIX = 'msg_goal_manager_';
/** Consecutive charged turns that errored without a plan before the Goal pauses. */
export const MAX_FAILED_MANAGER_TURNS = 5;
const FAILED_TURN_BASE_BACKOFF_MS = 60_000;
const FAILED_TURN_MAX_BACKOFF_MS = 30 * 60_000;

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
const PLAN_REJECTION = {
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
  review_changed: {
    message:
      'Task review feedback changed; exit without a plan so the next bounded turn can read it',
    trpc: 'CONFLICT',
  },
  stale_input: { message: 'Stale planning input; no plan applied', trpc: 'CONFLICT' },
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
type PlanAdmission =
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

const rejectPlan = (code: PlanRejectionCode, opStatus?: string): PlanAdmission => ({
  code,
  message: PLAN_REJECTION[code].message,
  ok: false,
  opStatus,
  trpcCode: PLAN_REJECTION[code].trpc,
});

export type FailedTurnDecision =
  | { action: 'pause'; failure: RunFailure; reason: string }
  | {
      action: 'retry';
      /** Whether the failed turn counts toward the manager turn budget. */
      charged: boolean;
      failure: RunFailure;
      failedTurns: number;
      offlineTurns: number;
      retryAfter: string;
    };

/**
 * What to do after a planning turn ended in an error without committing a plan.
 *
 * It follows the same classification as Task recovery (`classifyRunFailure`):
 * - A usage window that reports its reset waits for that reset. The refused
 *   turn did no work, so it is not charged.
 * - A device that is not reachable follows the Task offline schedule
 *   (30 min, doubling to 8 h, six retries). It is not charged, and the Goal
 *   pauses once the device stays away.
 * - Credentials, spend or permission pause at once, because no retry fixes them.
 * - Anything else backs off exponentially from 1 min to 30 min and is charged.
 *   `MAX_FAILED_MANAGER_TURNS` in a row pause the Goal.
 *
 * Before this, every failure re-dispatched on the next tick. That is how one Goal
 * spent its whole 100-turn budget on a session limit in 20 minutes.
 */
export const decideFailedTurn = (
  error: unknown,
  streak: { failedTurns?: number; offlineTurns?: number },
  now = Date.now(),
): FailedTurnDecision => {
  const failure = classifyRunFailure(error);
  const failedTurns = streak.failedTurns ?? 0;
  // `offlineTurns` counts turns that never reached their device back to back. Any
  // other ending reached it, so only a device failure carries the streak forward.
  const offlineTurns = failure.kind === 'device_unavailable' ? (streak.offlineTurns ?? 0) : 0;
  const message = (error as { message?: unknown } | undefined)?.message;
  const detail = typeof message === 'string' && message ? `: ${message}` : '';

  if (failure.kind === 'quota_reset' && failure.resetsAt! + QUOTA_RESET_MARGIN_MS > now)
    return {
      action: 'retry',
      charged: false,
      failedTurns,
      failure,
      offlineTurns,
      retryAfter: new Date(failure.resetsAt! + QUOTA_RESET_MARGIN_MS).toISOString(),
    };
  if (failure.kind === 'device_unavailable') {
    const retryAt = nextDeviceOfflineRetryAt(offlineTurns + 1, new Date(now));
    if (!retryAt)
      return { action: 'pause', failure, reason: `Main Agent device stayed offline${detail}` };
    return {
      action: 'retry',
      charged: false,
      failedTurns,
      failure,
      offlineTurns: offlineTurns + 1,
      retryAfter: retryAt.toISOString(),
    };
  }
  if (failure.kind === 'needs_user')
    return {
      action: 'pause',
      failure,
      reason: `Main Agent needs credentials, spend or permission fixed${detail}`,
    };
  if (failedTurns + 1 >= MAX_FAILED_MANAGER_TURNS)
    return {
      action: 'pause',
      failure,
      reason: `Main Agent failed ${failedTurns + 1} turns in a row without a plan${detail}`,
    };
  const backoff = Math.min(
    FAILED_TURN_MAX_BACKOFF_MS,
    FAILED_TURN_BASE_BACKOFF_MS * 2 ** failedTurns,
  );
  return {
    action: 'retry',
    charged: true,
    failedTurns: failedTurns + 1,
    failure,
    offlineTurns,
    retryAfter: new Date(now + backoff).toISOString(),
  };
};

/**
 * The token a planning turn is keyed by, carrying the Goal it belongs to.
 *
 * The source message `msg_goal_manager_<token>` is the only durable link from a
 * manager operation back to its Goal, so the Goal id has to sit inside it for
 * management spend to be attributable. Without it, a conversation this Goal was
 * moved out of — which can be a normal conversation that later supervised
 * another Goal — would charge that other Goal's turns to this one's budget.
 */
const managerTurnToken = (goalId: string) => `${goalId}_${randomUUID()}`;

/** Excludes only the manager's own receipt. Concurrent policy/graph changes invalidate its plan. */
export const managerSnapshot = (graph: GoalGraphSnapshot) => {
  // Coordinator receipts are not planning input: arming a Task's quota wake while a
  // turn runs must not make that turn's plan stale.
  const { managerState: _state, quotaRetryWakeAt: _quotaWake, ...config } = graph.goal.config ?? {};
  return createHash('sha256')
    .update(
      JSON.stringify({
        requirement: graph.goal.requirement,
        config,
        maxRounds: graph.goal.maxRounds,
        maxTotalCost: graph.goal.maxTotalCost,
        nodes: graph.nodes,
        edges: graph.edges,
        decisions: graph.decisions,
        versions: graph.workVersions.map(({ nodeId, workVersionId, relation }) => ({
          nodeId,
          workVersionId,
          relation,
        })),
      }),
    )
    .digest('hex');
};

/** Durable wakeups around ordinary CLI-capable Agent runs. No supervisor builtin tools. */
/** A takeover problem is identified by the task it blocked, not by its wording
 *  alone: "Task attempt budget was exhausted" is the same sentence for every task
 *  that reaches it, so a reason-only key makes the second task inherit the first
 *  one's answer. */
export const problemKey = (problem: { reason: string; taskId?: string }) =>
  `${problem.taskId ?? 'goal'}::${problem.reason}`;

/**
 * The problem a settled takeover turn already answered, with the answer.
 *
 * Reading it is how the coordinator tells "nobody has looked at this yet" from
 * "the main Agent looked and this is what it said". Any committed answer counts,
 * not just `escalate`: if the Agent's plan did not unstick the Goal, handing the
 * same problem over again only buys the same plan, so the Gate is the honest next
 * step and the Agent's reasoning rides along on it.
 */
export const answeredProblem = (state?: GoalManagerState) =>
  state?.consumed && state.problem && state.submitted
    ? { ask: state.submitted.ask, key: state.problem, reason: state.submitted.reason }
    : undefined;

export class GoalManagerService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  usage = async (goalId: string, state?: GoalManagerState) => {
    // The planning topic can be the user's own conversation (`/goal`), so only
    // manager turns count as management spend: the dispatched ones by their
    // server-minted source message, the adopted one by its operation id. The
    // rest of that conversation is the user's chat, not the goal's budget.
    if (!state) return { totalCost: 0, totalTokens: 0 };
    const model = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    // Later receipts replace `adopted` / `operationId`, so the adopted run is
    // read from the id every receipt carries forward.
    const adoptedId = state.adoptedOperationId ?? (state.adopted ? state.operationId : undefined);
    // A handoff moves later turns to the new agent's topic; the turns already
    // spent in the conversations it left behind still belong to the Goal, so
    // they are summed too instead of dropping out of its budget.
    const goalTokenPrefix = `${MANAGER_SOURCE_MESSAGE_PREFIX}${goalId}_`;
    // One read per conversation the Goal planned in. The list grows with every
    // handoff, so the fan-out is capped rather than left to the history length.
    const reads = await pMap(
      [state.topicId, ...(state.previousTopicIds ?? [])],
      async (topicId, index) => ({
        current: index === 0,
        operations: await model.listByTopic(topicId, 100),
      }),
      { concurrency: 5 },
    );
    const operations = reads.flatMap(({ current, operations: topicOperations }) =>
      topicOperations.filter((op) => {
        if (op.id === adoptedId) return true;
        const source = op.appContext?.sourceMessageId;
        // The Goal's own conversation keeps the historical prefix match: a turn
        // dispatched before the token carried the Goal id has no marker to match.
        if (current) return source?.startsWith(MANAGER_SOURCE_MESSAGE_PREFIX);
        // A conversation the Goal moved out of is matched on the Goal's own
        // marker only. It can be shared with another Goal created in the same
        // conversation, whose turns are not this Goal's spend.
        return source?.startsWith(goalTokenPrefix);
      }),
    );
    // The adopted run lives on the conversation that created the Goal; keep it
    // counted even when it is not among the topics read above.
    if (adoptedId && !operations.some((op) => op.id === adoptedId)) {
      const adoptedRun = await model.findById(adoptedId);
      if (adoptedRun) operations.push(adoptedRun);
    }
    return {
      totalCost: operations.reduce((sum, op) => sum + (Number(op.totalCost) || 0), 0),
      totalTokens: operations.reduce((sum, op) => sum + (op.totalTokens ?? 0), 0),
    };
  };

  /**
   * The operation that is the current planning turn. A dispatched turn is found
   * by the source message the manager minted for it; an adopted turn — the
   * conversation run that created the goal — never had one, so it is the
   * operation recorded at adoption.
   */
  private turnOperation = async (operations: AgentOperationModel, state: GoalManagerState) =>
    state.adopted
      ? state.operationId
        ? ((await operations.findById(state.operationId)) ?? undefined)
        : undefined
      : operations.findByTopicSourceMessage(
          state.topicId,
          `${MANAGER_SOURCE_MESSAGE_PREFIX}${state.token}`,
        );

  /**
   * Make the conversation run that created this goal its first planning turn.
   *
   * `/goal` in a conversation asks the agent already running there to supervise:
   * it creates the goal and plans it in the same run, so the user watches both
   * happen in their conversation. Dispatching a separate first turn would wait on
   * that very run to release the topic. The receipt carries the same snapshot and
   * review hash a dispatched turn would, so `submit` validates the plan the same
   * way; only the operation lookup differs (`adopted`).
   */
  adoptConversationTurn = async (goalId: string, run: { operationId: string; topicId: string }) =>
    this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (!goal?.config?.manager) throw new Error('Goal has no main Agent policy to adopt a turn');
      if (goal.config.managerState) throw new Error('Goal already has a planning turn');
      // A local desktop run has no server operation row; the caller already
      // matched its conversation to the goal agent. A recorded run must match too.
      const operation = await new AgentOperationModel(db, this.userId, this.workspaceId).findById(
        run.operationId,
      );
      if (operation && (operation.topicId !== run.topicId || operation.agentId !== goal.agentId))
        throw new Error('The adopted run does not belong to the goal agent');
      const graph = await this.graph(db).getGraph(goalId);
      if (!graph) throw new Error('Goal not found');
      const state: GoalManagerState = {
        adopted: true,
        adoptedOperationId: run.operationId,
        operationId: run.operationId,
        reviewSnapshot: (await this.reviews(graph, db)).hash,
        snapshot: managerSnapshot(graph),
        startedAt: new Date().toISOString(),
        token: randomUUID(),
        topicId: run.topicId,
        turns: 1,
      };
      await this.save(db, goalId, state);
      if (goal.status === 'planning') await model.updateStatus(goalId, 'running');
      return state;
    });

  /**
   * Move the management conversation onto the agent that now supervises the Goal.
   *
   * The management conversation lives in the goal agent's own history, so
   * handing the Goal to another agent leaves `managerState.topicId` pointing at a
   * conversation the new agent does not own: the supervision panel keeps showing
   * the previous agent's planning thread, and its "open conversation" link opens
   * that agent's chat. Creating the new agent's conversation here, at the
   * handoff, keeps the panel and its link honest immediately instead of only
   * after the next planning claim.
   *
   * Declines while a turn is unclaimed in flight: `settleInFlight` finds that
   * turn's run through `state.topicId`, so re-pointing early would strand it as
   * unconfirmed and pause the Goal. `startTurn` migrates on the next claim in
   * that case. It also declines when the Goal no longer belongs to the target: an
   * overlapping handoff that landed later owns the answer, and migrating to this
   * call's stale target would leave the conversation owned by an agent the Goal
   * is not assigned to. The Goal row is locked, like every other receipt write.
   */
  moveConversationTo = async (
    goalId: string,
    agentId: string,
  ): Promise<GoalManagerState | undefined> =>
    this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      const state = goal?.config?.managerState;
      if (!goal || !state || !state.consumed || goal.agentId !== agentId) return;
      const topicModel = new TopicModel(db, this.userId, this.workspaceId);
      const current = await topicModel.findById(state.topicId);
      if (current?.agentId === agentId) return;
      const topic = await topicModel.create({
        agentId,
        title: `Goal management: ${goal.title}`,
        // Read from the goal page's supervision panel; keeps the planning
        // conversation out of the agent's chat sidebar and Recent.
        trigger: TopicTrigger.GoalSupervision,
      });
      const next: GoalManagerState = {
        ...state,
        topicId: topic.id,
        previousTopicIds: [...new Set([...(state.previousTopicIds ?? []), state.topicId])],
      };
      await this.save(db, goalId, next);
      return next;
    });

  /**
   * Attach an existing goal to a topic so it ends up in the state
   * `/goal` in that topic would have left it: the topic's agent is
   * the goal agent, the topic is the goal's `topic` subject, the goal
   * has a main Agent policy, and its management topic
   * (`managerState.topicId`) is this topic, so later planning turns land
   * there.
   *
   * The graph, Tasks, budgets and status are left alone. The binding run is
   * adopted as a planning turn only when the goal is where a freshly created
   * topic goal would be — no turn in flight and no unfinished Task to
   * preempt — because an adopted turn holds task coordination until it settles.
   * Otherwise the next turn the coordinator starts is dispatched here.
   *
   * Refused while a planning turn is in flight elsewhere: `settleInFlight`
   * finds that turn's run through `state.topicId`, so moving it would strand
   * the turn and pause the goal.
   */
  bindTopic = async (
    goalId: string,
    run: { agentId: string; operationId: string; topicId: string },
    options?: { force?: boolean },
  ): Promise<{
    goal: GoalItem;
    previousAgentId: string | null;
    previousSubject: { id: string | null; type: GoalItem['subjectType'] };
    turnToken?: string;
  }> =>
    this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      if (finishedGoalStatuses.has(goal.status))
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Goal is ${goal.status}; a finished goal cannot be bound to a topic`,
        });

      const previousSubject = { id: goal.subjectId, type: goal.subjectType };
      const alreadyBound = goal.subjectType === 'topic' && goal.subjectId === run.topicId;
      if (!alreadyBound && goal.subjectId && !options?.force)
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Goal is already bound to ${goal.subjectType} ${goal.subjectId}; pass force to move it to this topic`,
        });

      const state = goal.config?.managerState;
      if (
        state &&
        !state.consumed &&
        (state.topicId !== run.topicId || goal.agentId !== run.agentId)
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A planning turn of this goal is in flight in ${state.topicId}; wait for it to settle (or confirm its exit with lh goal resume ${goalId} --confirm-exit) before binding`,
        });

      // Same default as `createFromConversation`: a topic goal always
      // has a main Agent; an existing policy (turn cap, instruction) is kept.
      await db
        .update(goals)
        .set({
          agentId: run.agentId,
          config: sql`COALESCE(${goals.config}, '{}'::jsonb) || jsonb_build_object('manager', COALESCE(${goals.config}->'manager', '{}'::jsonb))`,
          subjectId: run.topicId,
          subjectType: 'topic',
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId));

      let turnToken: string | undefined;
      // An in-flight turn reaching here is already this topic's.
      if (!state || state.consumed) {
        const graph = await this.graph(db).getGraph(goalId);
        if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        const previousTopicIds = [
          ...new Set([
            ...(state?.previousTopicIds ?? []),
            ...(state?.topicId && state.topicId !== run.topicId ? [state.topicId] : []),
          ]),
        ];
        const maxTurns = graph.goal.config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS;
        const quiet =
          activeStatuses.has(goal.status) &&
          !state?.readyForAcceptance &&
          (state?.turns ?? 0) < maxTurns &&
          !graph.decisions.some((d) => d.status === 'pending') &&
          !graph.nodes.some((n) => n.kind === 'task' && !terminalNodes.has(n.status)) &&
          !(await this.budgetBlocked(graph, db));
        let next: GoalManagerState;
        if (quiet) {
          // What `adoptConversationTurn` records for a goal created here.
          next = {
            adopted: true,
            adoptedOperationId: run.operationId,
            operationId: run.operationId,
            ...(previousTopicIds.length > 0 && { previousTopicIds }),
            reviewSnapshot: (await this.reviews(graph, db)).hash,
            snapshot: managerSnapshot(graph),
            startedAt: new Date().toISOString(),
            token: randomUUID(),
            topicId: run.topicId,
            turns: (state?.turns ?? 0) + 1,
          };
          turnToken = next.token;
        } else {
          // No turn now: re-point the settled receipt (or record a settled
          // one with no turn spent) so the next turn the coordinator starts is
          // dispatched into this topic instead of a new topic.
          next = state
            ? {
                ...state,
                ...(previousTopicIds.length > 0 && { previousTopicIds }),
                topicId: run.topicId,
              }
            : {
                consumed: true,
                snapshot: managerSnapshot(graph),
                startedAt: new Date().toISOString(),
                token: managerTurnToken(goalId),
                topicId: run.topicId,
                turns: 0,
              };
        }
        await this.save(db, goalId, next);
        if (quiet && goal.status === 'planning') await model.updateStatus(goalId, 'running');
      }

      if (!alreadyBound || goal.agentId !== run.agentId) {
        const moved =
          previousSubject.id && !alreadyBound
            ? ` (moved from ${previousSubject.type} ${previousSubject.id})`
            : '';
        const agentChange =
          goal.agentId !== run.agentId
            ? `; goal agent ${goal.agentId ?? 'none'} → ${run.agentId}`
            : '';
        await new GoalGraphModel(db, this.userId, this.workspaceId, {
          id: run.agentId,
          type: 'agent',
        }).recordGoalUpdate(goalId, {
          operationId: run.operationId,
          reason: `bound to topic ${run.topicId}${moved}${agentChange}`,
        });
      }

      return {
        goal: (await model.findById(goalId))!,
        previousAgentId: goal.agentId,
        previousSubject,
        turnToken,
      };
    });

  private save = async (db: LobeChatDatabase, id: string, state: GoalManagerState) => {
    // Caller holds the owned Goal row lock. Do not overwrite concurrent policy namespaces.
    await db
      .update(goals)
      .set({
        config: sql`jsonb_set(COALESCE(${goals.config}, '{}'::jsonb), '{managerState}', ${JSON.stringify(state)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id));
  };

  private graph = (db = this.db) => new GoalGraphModel(db, this.userId, this.workspaceId);
  private coordinatorGraph = (db = this.db) =>
    new GoalGraphModel(db, this.userId, this.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });

  private reviews = async (graph: GoalGraphSnapshot, db = this.db) => {
    const tasks = new TaskModel(db, this.userId, this.workspaceId);
    const visible = await tasks.findByIds(graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])));
    // The node title names the task the way the goal page does, for the person
    // reading the card; kept out of the hash, so a rename does not invalidate a
    // turn's feedback snapshot.
    const titles = new Map(graph.nodes.flatMap((n) => (n.taskId ? [[n.taskId, n.title]] : [])));
    const comments = (
      await Promise.all(
        visible.map(async (task) =>
          (await tasks.getComments(task.id)).map((comment) => ({
            taskId: task.id,
            id: comment.id,
            content: comment.content,
            authorUserId: comment.authorUserId,
            authorAgentId: comment.authorAgentId,
            updatedAt: comment.updatedAt,
          })),
        ),
      )
    )
      .flat()
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      hash: createHash('sha256').update(JSON.stringify(comments)).digest('hex'),
      notes: [...comments]
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .map((c) => ({
          author: c.authorAgentId ? `agent ${c.authorAgentId}` : 'user',
          content: c.content,
          taskId: c.taskId,
          taskTitle: titles.get(c.taskId) ?? undefined,
          updatedAt: c.updatedAt,
        })),
    };
  };

  /** Whether a budget bound is reached, with the numbers behind it for `lh goal state`. */
  private budgetFacts = async (graph: GoalGraphSnapshot, db = this.db) => {
    const spend = await new TaskTopicModel(db, this.userId, this.workspaceId).sumRunCostByTaskIds(
      graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])),
    );
    const management = await new GoalManagerService(db, this.userId, this.workspaceId).usage(
      graph.goal.id,
      graph.goal.config?.managerState,
    );
    const goal = graph.goal;
    const totalCost = spend.totalCost + management.totalCost;
    const deadline = goal.config?.schedule?.deadline ?? null;
    return {
      blocked:
        (goal.maxRounds !== null && spend.runs >= goal.maxRounds) ||
        (goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost)) ||
        (!!deadline && Date.now() >= Date.parse(deadline)),
      deadline,
      maxRounds: goal.maxRounds,
      maxTotalCost: goal.maxTotalCost,
      runs: spend.runs,
      totalCost,
    };
  };

  private budgetBlocked = async (graph: GoalGraphSnapshot, db = this.db) =>
    (await this.budgetFacts(graph, db)).blocked;

  private wait = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await scheduleGoalAdvance({
      goalId,
      userId: this.userId,
      workspaceId: this.workspaceId,
      delay: 5,
    });
    return { goalId, outcome: 'waiting_external', message };
  };

  /** Whether the device the last turn could not reach is connected again. */
  private offlineDeviceIsBack = async (state: GoalManagerState) => {
    const route = state.offlineDevice;
    if (!route || !deviceGateway.isConfigured) return false;
    const devices = await deviceGateway.queryDeviceList(route.userId, route.workspaceId);
    return devices.some((device) => device.deviceId === route.deviceId);
  };

  private pause = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (goal && activeStatuses.has(goal.status)) {
        await model.updateStatus(goalId, 'paused');
        // The system paused it (a spent turn budget, an unconfirmed main Agent
        // turn), so the timeline must not file it as the owner's pause.
        await this.coordinatorGraph(db).recordGoalStatus(goalId, goal.status, 'paused', message);
      }
    });
    return { goalId, outcome: 'no_progress', message };
  };

  stop = async (graph: GoalGraphSnapshot) => {
    const state = graph.goal.config?.managerState;
    if (!state || state.consumed) return;
    const operations = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    const op = state.operationId
      ? await operations.findById(state.operationId)
      : await operations.findByTopicSourceMessage(state.topicId, `msg_goal_manager_${state.token}`);
    if (!op)
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'Main Agent dispatch is unconfirmed; retain the Goal until its execution can be reconciled',
      });
    if (terminalOperations.has(op.status)) return;
    const result = await new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    }).interruptTask({ operationId: op.id, topicId: state.topicId });
    if (!result.success || result.deviceCancellationConfirmed === false)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Main Agent exit was not confirmed; Goal was not deleted',
      });
  };

  /**
   * Advance the goal through its main Agent.
   *
   * `mayStartTurn` is what orders the two planners. The system's own
   * exploration planner owns the ordinary path; a main Agent is the fallback for
   * problems that planner cannot express, so on a Goal that has exploration
   * configured this settles an in-flight turn or resumes an explicit continuation.
   * A Goal whose only planner IS the main Agent keeps starting turns here.
   */
  advance = async (
    graph: GoalGraphSnapshot,
    options?: { mayStartTurn?: boolean },
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    const waiting = await new GoalWaitService(this.db, this.userId, this.workspaceId).advance(
      graph,
    );
    if (waiting) return waiting;
    const state = graph.goal.config?.managerState;
    if (options?.mayStartTurn === false && !state?.replanReason && !state?.wait?.wake) return null;
    return this.startTurn(graph);
  };

  /**
   * Hand a problem the coordinator could not route to the main Agent, instead of
   * stopping the Goal on a person.
   *
   * The invitation IS the authorization: the caller has already decided it would
   * otherwise open a human gate, so the ordinary "is there unfinished work" and
   * "is this a recognised transport failure" narrowings do not apply — those
   * exist to stop an uninvited turn from preempting running work. Turn limits,
   * budgets and the compare-and-swap claim still hold, and a main Agent that
   * cannot help answers `escalate`, which puts the gate back.
   */
  takeOver = async (
    graph: GoalGraphSnapshot,
    problem: { reason: string; taskId?: string },
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    // Already answered: a takeover turn that ran for THIS problem has had its say,
    // so handing it over again would buy the same plan instead of asking a person.
    // `answeredProblem` is what the caller attaches to the gate.
    if (answeredProblem(graph.goal.config?.managerState)?.key === problemKey(problem)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    return this.startTurn(graph, problem);
  };

  /** Return measured shortfalls to planning without weakening acceptance. */
  reconsiderAcceptance = async (
    graph: GoalGraphSnapshot,
    reason: string,
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    if (!graph.goal.config?.managerState) return this.startTurn(graph, undefined, reason);
    const changed = await this.db.transaction(async (db) => {
      const goal = await new GoalModel(db, this.userId, this.workspaceId).lockById(graph.goal.id);
      const state = goal?.config?.managerState;
      if (
        !goal ||
        !activeStatuses.has(goal.status) ||
        !state?.consumed ||
        state.token !== graph.goal.config?.managerState?.token
      )
        return false;
      const current = await this.graph(db).getGraph(goal.id);
      if (!current || managerSnapshot(current) !== managerSnapshot(graph)) return false;
      await this.save(db, goal.id, {
        ...state,
        readyForAcceptance: false,
        replanReason: reason,
        problem: undefined,
        problemTaskId: undefined,
      });
      return true;
    });
    return changed ? { goalId: graph.goal.id, outcome: 'advanced', message: reason } : null;
  };

  /** Shared entry conditions: a policy and its agent, an active Goal, and nobody waiting on a person. */
  private eligible = (graph: GoalGraphSnapshot) =>
    Boolean(
      graph.goal.config?.manager &&
      graph.goal.agentId &&
      activeStatuses.has(graph.goal.status) &&
      !graph.decisions.some((d) => d.status === 'pending'),
    );

  /**
   * Poll a dispatched turn. Runs on every tick regardless of who leads planning:
   * a turn already paid for has to be settled, or its plan would never land.
   */
  private settleInFlight = async (graph: GoalGraphSnapshot): Promise<GoalTickResult | null> => {
    const { goal } = graph;
    const state = goal.config?.managerState;
    if (state && !state.consumed) {
      const operation = await this.turnOperation(
        new AgentOperationModel(this.db, this.userId, this.workspaceId),
        state,
      );
      // An adopted local desktop run has no server operation to watch exit; its
      // submitted plan is the only settlement the server can observe.
      const settledLocally = !!state.adopted && !operation && !!state.submitted;
      // A dispatched turn never ran when its dispatch was refused the topic
      // reservation — the verdict `recordUnstartedDispatch` stored from the
      // error itself. That refusal comes before the planning message or any
      // operation is written, and the planning topic can be the owner's busy
      // conversation, which is how a turn gets stuck. With no run to confirm,
      // settle it like a turn that exited without a plan instead of pausing:
      // pausing left the Goal stuck for good, because every resume re-read this
      // same turn and paused again.
      //
      // Nothing is inferred from rows: a missing operation row proves nothing
      // (the runtime keeps going when that insert fails), and a missing planning
      // message may be one the owner deleted or one a still-pending call has not
      // written yet. Every other turn still pauses as unconfirmed; the owner can
      // confirm its exit on resume. An adopted turn is exempt.
      const neverStarted =
        !state.adopted &&
        !operation &&
        !!state.dispatchNeverStarted &&
        Date.now() - Date.parse(state.startedAt) > TIMEOUT_MS;
      if (
        !settledLocally &&
        !neverStarted &&
        (!operation || !terminalOperations.has(operation.status))
      ) {
        if (operation?.status === 'waiting_for_human') {
          await this.wait(goal.id, 'Main Agent is waiting for a human decision');
          return {
            goalId: goal.id,
            outcome: 'waiting_human',
            message: 'Main Agent is waiting for a human decision',
          };
        }
        if (Date.now() - Date.parse(state.startedAt) > TIMEOUT_MS) {
          return this.pause(
            goal.id,
            `Main Agent execution is unconfirmed or timed out; no replacement was dispatched. Once its run has ended, confirm and resume with: lh goal resume ${goal.id} --confirm-exit`,
          );
        }
        return this.wait(goal.id, 'Waiting for main Agent CLI planning turn');
      }
      const failed = await this.db.transaction(async (db) => {
        const fresh = await new GoalModel(db, this.userId, this.workspaceId).lockById(goal.id);
        const current = fresh?.config?.managerState;
        if (current?.token !== state.token || current.consumed) return;
        const settled: GoalManagerState = {
          ...current,
          operationId: operation?.id ?? state.operationId,
          consumed: true,
        };
        const cleared = {
          failedTurns: undefined,
          offlineDevice: undefined,
          offlineTurns: undefined,
          retryAfter: undefined,
        };
        // A committed plan is progress whatever the run's ending; only an errored
        // turn that committed nothing gates the next dispatch.
        if (current.submitted || operation?.status !== 'error') {
          await this.save(db, goal.id, { ...settled, ...cleared });
          return;
        }
        const decision = decideFailedTurn(operation.error, current);
        if (decision.action === 'pause') {
          // The person who resumes the Goal gets a fresh retry schedule. Pause in
          // this same transaction: committing the consumed receipt first would
          // let a concurrent tick claim and dispatch a replacement turn before
          // the pause took the row lock.
          await this.save(db, goal.id, { ...settled, ...cleared });
          const message = `${decision.reason}. Resume with: lh goal resume ${goal.id}`;
          if (activeStatuses.has(fresh!.status)) {
            await new GoalModel(db, this.userId, this.workspaceId).updateStatus(goal.id, 'paused');
            await this.graph(db).recordGoalStatus(goal.id, fresh!.status, 'paused', message);
          }
          return { ...decision, reason: message };
        }
        await this.save(db, goal.id, {
          ...settled,
          failedTurns: decision.failedTurns || undefined,
          offlineDevice:
            decision.failure.kind === 'device_unavailable'
              ? readDeviceDispatchRoute(operation.error)
              : undefined,
          offlineTurns: decision.offlineTurns || undefined,
          retryAfter: decision.retryAfter,
          turns: decision.charged ? current.turns : Math.max(0, current.turns - 1),
        });
        return decision;
      });
      if (failed?.action === 'pause')
        return { goalId: goal.id, outcome: 'no_progress', message: failed.reason };
      if (failed) {
        await scheduleGoalAdvance({
          goalId: goal.id,
          userId: this.userId,
          workspaceId: this.workspaceId,
          delay: GoalWaitService.arm(failed.retryAfter).delay,
        });
        return {
          goalId: goal.id,
          outcome: 'waiting_external',
          message: `Main Agent turn failed without a plan (${failed.failure.kind}); the next turn starts after ${failed.retryAfter}`,
        };
      }
      return {
        goalId: goal.id,
        outcome: 'advanced',
        message: state.submitted
          ? 'Main Agent plan committed; normal Task coordination continues'
          : neverStarted
            ? 'Main Agent turn never started; a new bounded turn will reread durable state'
            : 'Main Agent exited without a plan; a new bounded turn will reread durable state',
      };
    }
    return null;
  };

  /**
   * Whether an UNINVITED turn must stand down. A main Agent that nobody asked for
   * may only plan when the graph is quiet, or recover a failure the transport
   * whitelist recognises — anything else is work in flight that it would preempt.
   */
  private uninvitedTurnBlocked = async (
    graph: GoalGraphSnapshot,
    unfinished: GoalGraphSnapshot['nodes'],
    tasks: TaskItem[],
  ) => {
    const failed = tasks.find((t) => t.status === 'failed');
    if (!failed) return unfinished.length > 0;
    // Supervision owns recognised transport failures, and it is both cheaper than
    // a planning turn and stricter about who authored the status. Claiming one
    // uninvited would reverse that order and spend a turn on a failure the
    // supervisor recovers on its own; whatever it declines reaches
    // `gateOrTakeOver`, which invites this Agent properly.
    if (graph.goal.config?.supervision?.enabled) return true;
    const runs = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTaskId(
      failed.id,
    );
    const op = runs[0]?.operationId
      ? await new AgentOperationModel(this.db, this.userId, this.workspaceId).findById(
          runs[0].operationId,
        )
      : undefined;
    return !recoveryEligibility(graph, failed, op, false, countUnchargedRuns(runs)).eligible;
  };

  private startTurn = async (
    graph: GoalGraphSnapshot,
    problem?: { reason: string; taskId?: string },
    continuation?: string,
  ): Promise<GoalTickResult | null> => {
    const { goal } = graph;
    const policy = goal.config!.manager!;
    // The goal agent plans; `eligible` has already required one.
    const agentId = goal.agentId!;
    const state = goal.config?.managerState;
    const nodes = graph.nodes.filter((n) => n.kind === 'task');
    const unfinished = nodes.filter((n) => !terminalNodes.has(n.status));
    // An invited turn skips the checks below. They ask "should an uninvited main
    // Agent interrupt what is running", and the caller has already answered a
    // harder question: the coordinator is out of moves and the alternative is
    // stopping the Goal on a person. The acceptance guard belongs to that set too:
    // it means "verification exists, stop planning more work", which is right for an
    // uninvited turn and wrong for a takeover invited BECAUSE the terminal
    // acceptance is the thing that failed.
    if (!problem) {
      if (state?.readyForAcceptance || nodes.some((n) => n.title === GOAL_ACCEPTANCE_TASK_TITLE))
        return null;
      const tasks = await new TaskModel(this.db, this.userId, this.workspaceId).findByIds(
        unfinished.flatMap((n) => (n.taskId ? [n.taskId] : [])),
      );
      const blocked = await this.uninvitedTurnBlocked(graph, unfinished, tasks);
      if (blocked) return null;
    }
    if (
      (state?.turns ?? 0) >= (policy.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS) ||
      (await this.budgetBlocked(graph))
    ) {
      // An invited turn declines instead of pausing. The caller was about to open
      // a gate carrying the actual problem; pausing here would replace that
      // question with "the main Agent is out of turns" and lose it.
      if (problem) return null;
      return this.pause(goal.id, 'Goal or main Agent turn budget exhausted');
    }
    // The previous turn failed without a plan. Its settlement already queued the
    // wakeup for this time, so a tick arriving earlier (the sweep, a Task event)
    // only reports the wait instead of queueing another one. An invited turn
    // waits too: it would fail the same way, and the problem is still there later.
    // A device seen back online ends the wait early, as it does for Tasks.
    if (
      state?.retryAfter &&
      Date.parse(state.retryAfter) > Date.now() &&
      !(await this.offlineDeviceIsBack(state))
    )
      return {
        goalId: goal.id,
        outcome: 'waiting_external',
        message: `Main Agent turn deferred until ${state.retryAfter} after a failed turn`,
      };
    const claimed = await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const fresh = await model.lockById(goal.id);
      // `managerSnapshot` does not cover the goal agent, so a handoff landing
      // between the caller's graph read and this lock would otherwise dispatch
      // the previous supervisor and spend one of the new supervisor's turns.
      if (
        !fresh ||
        fresh.agentId !== agentId ||
        !activeStatuses.has(fresh.status) ||
        fresh.config?.managerState?.token !== state?.token ||
        fresh.config?.managerState?.turns !== state?.turns ||
        (fresh.config?.managerState && !fresh.config.managerState.consumed)
      )
        return;
      const current = await this.graph(db).getGraph(goal.id);
      if (!current || managerSnapshot(current) !== managerSnapshot(graph)) return;
      if (
        (fresh.config?.managerState?.turns ?? 0) >=
          (fresh.config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS) ||
        (await this.budgetBlocked(current, db))
      )
        return;
      // The management conversation lives in the goal agent's own history. After
      // a handoff the previous agent's topic is not this agent's to continue.
      // Read it from the LOCKED row, not the caller's graph: `moveConversationTo`
      // can have migrated the conversation between the graph read and this claim,
      // and going by the stale topic would mint a second one for the same agent.
      const freshState = fresh.config?.managerState;
      const topicModel = new TopicModel(db, this.userId, this.workspaceId);
      const previousTopic = freshState?.topicId
        ? await topicModel.findById(freshState.topicId)
        : undefined;
      const topicId =
        previousTopic?.agentId === agentId
          ? previousTopic.id
          : (
              await topicModel.create({
                agentId,
                title: `Goal management: ${goal.title}`,
                // Read from the goal page's supervision panel; keeps the planning
                // conversation out of the agent's chat sidebar and Recent.
                trigger: TopicTrigger.GoalSupervision,
              })
            ).id;
      // This claim is the other place the management topic changes (besides
      // `moveConversationTo`, which only runs between turns): a handoff that
      // landed mid-turn migrates here. The conversation being left keeps
      // counting, so it joins the history the receipt carries forward.
      const previousTopicIds = [
        ...new Set([
          ...(freshState?.previousTopicIds ?? []),
          ...(freshState?.topicId && freshState.topicId !== topicId ? [freshState.topicId] : []),
        ]),
      ];
      // The cutoff the next turn splits new from earlier feedback at. Taken before
      // the comments are read, so a comment committed while they load is never
      // dated before a turn that did not see it; at worst it is shown as new twice.
      const startedAt = new Date().toISOString();
      const reviews = await this.reviews(current, db);
      const next: GoalManagerState = {
        ...(problem
          ? {
              problem: problemKey(problem),
              ...(problem.taskId && { problemTaskId: problem.taskId }),
            }
          : {}),
        ...(state?.adoptedOperationId && { adoptedOperationId: state.adoptedOperationId }),
        ...(previousTopicIds.length > 0 && { previousTopicIds }),
        // Failure streaks span turns; settling a turn that did not error resets them.
        ...(freshState?.failedTurns && { failedTurns: freshState.failedTurns }),
        ...(freshState?.offlineTurns && { offlineTurns: freshState.offlineTurns }),
        reviewSnapshot: reviews.hash,
        topicId,
        turns: (state?.turns ?? 0) + 1,
        token: managerTurnToken(goal.id),
        snapshot: managerSnapshot(current),
        startedAt,
      };
      await this.save(db, goal.id, next);
      if (fresh.status === 'planning') await model.updateStatus(goal.id, 'running');
      // Split at the previous turn's start, so the message names what is new to
      // this turn instead of resending the same comments every turn.
      // Only the latest FEEDBACK_NOTE_LIMIT are listed; the rest are counted so
      // the agent knows to read them in full rather than treating the list as all.
      const since = freshState?.startedAt ? Date.parse(freshState.startedAt) : undefined;
      const isNew = (n: (typeof reviews.notes)[number]) =>
        since === undefined || n.updatedAt.getTime() > since;
      const listed = reviews.notes.slice(-FEEDBACK_NOTE_LIMIT);
      const omitted = reviews.notes.slice(0, -FEEDBACK_NOTE_LIMIT);
      const note = ({ updatedAt, ...rest }: (typeof reviews.notes)[number]) => ({
        ...rest,
        updatedAt: updatedAt.toISOString(),
      });
      return {
        ...next,
        earlierFeedback: listed.filter((n) => !isNew(n)).map(note),
        newFeedback: listed.filter(isNew).map(note),
        omittedFeedback: {
          earlier: omitted.filter((n) => !isNew(n)).length,
          new: omitted.filter(isNew).length,
        },
        previousTurn: freshState && {
          neverStarted: freshState.dispatchNeverStarted,
          plan: freshState.submitted,
        },
      };
    });
    if (!claimed) return this.wait(goal.id, 'Another advance owns the planning turn');
    try {
      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).execAgent({
        agentId,
        appContext: { topicId: claimed.topicId },
        clientIds: { userMessageId: `msg_goal_manager_${claimed.token}` },
        autoStart: true,
        maxSteps: 80,
        userInterventionConfig: { approvalMode: 'headless' },
        prompt: buildGoalManagerPrompt({
          goalId: goal.id,
          requirement: goal.requirement ?? goal.title,
          instruction: policy.instruction,
          token: claimed.token,
          turn: claimed.turns,
          maxTurns: policy.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS,
          previousTurn: claimed.previousTurn,
          newFeedback: claimed.newFeedback,
          omittedFeedback: claimed.omittedFeedback,
          earlierFeedback: claimed.earlierFeedback,
          problem: problem?.reason,
          continuation:
            continuation ??
            state?.replanReason ??
            (state?.wait?.wake
              ? JSON.stringify({ reason: state.submitted?.reason, ...state.wait })
              : undefined),
        }),
      });
      await this.db.transaction(async (db) => {
        const fresh = await new GoalModel(db, this.userId, this.workspaceId).lockById(goal.id);
        if (fresh?.config?.managerState?.token === claimed.token) {
          await this.save(db, goal.id, {
            ...fresh.config.managerState,
            operationId: result.operationId,
          });
        }
      });
    } catch (error) {
      console.error(
        '[goal:manager] dispatch failed; next wakeup adopts any persisted operation',
        error,
      );
      // Only a refused topic reservation proves the turn never started: it is
      // raised before the planning message or any operation is written, and the
      // call has returned. Any other failure may come after a run went live, so
      // it stays unconfirmed. Decided from the error, never from rows the owner
      // can edit or delete.
      if (error instanceof TopicStartReservationError)
        await this.recordUnstartedDispatch(goal.id, claimed.token).catch((saveError) =>
          console.error('[goal:manager] failed to record the refused dispatch', saveError),
        );
    }
    return this.wait(goal.id, 'Main Agent dispatched with CLI planning access');
  };

  /**
   * The owner confirms that the planning turn the Goal is paused on has ended,
   * so resuming can settle it and plan afresh — the repair for a turn the server
   * cannot classify on its own, including turns recorded before
   * `dispatchNeverStarted` existed. Refused while the turn's run is still live:
   * interrupt it first, or a replacement would run beside it.
   */
  confirmTurnExit = async (goalId: string) =>
    this.db.transaction(async (db) => {
      const fresh = await new GoalModel(db, this.userId, this.workspaceId).lockById(goalId);
      const state = fresh?.config?.managerState;
      if (!state || state.consumed) return false;
      const operation = await this.turnOperation(
        new AgentOperationModel(db, this.userId, this.workspaceId),
        state,
      );
      if (operation && !terminalOperations.has(operation.status))
        throw new TRPCError({
          code: 'CONFLICT',
          message: `The main Agent run ${operation.id} is still ${operation.status}; interrupt it before confirming its exit`,
        });
      await this.save(db, goalId, { ...state, consumed: true });
      return true;
    });

  /** Mark a turn whose dispatch was refused its topic reservation as never started. */
  private recordUnstartedDispatch = async (goalId: string, token: string) =>
    this.db.transaction(async (db) => {
      const fresh = await new GoalModel(db, this.userId, this.workspaceId).lockById(goalId);
      if (fresh?.config?.managerState?.token === token)
        await this.save(db, goalId, { ...fresh.config.managerState, dispatchNeverStarted: true });
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
  private evaluateAdmission = async (
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
    const op = await this.turnOperation(
      new AgentOperationModel(db, this.userId, this.workspaceId),
      state,
    );
    if (input.operationId !== undefined) {
      // An adopted local desktop run has no server operation row; it is the run
      // whose id the conversation environment carried when the goal was created.
      const localAdoptedRun = !!state.adopted && !op && input.operationId === state.operationId;
      if (!localAdoptedRun && (op?.id !== input.operationId || op.agentId !== agentId))
        return rejectPlan('operation_mismatch', op?.status);
    }
    const graph = await this.graph(db).getGraph(goal.id);
    if (!graph || !activeStatuses.has(goal.status)) return rejectPlan('inactive', op?.status);
    if (graph.decisions.some((d) => d.status === 'pending'))
      return rejectPlan('pending_decision', op?.status);
    if (state.submitted) return { code: 'duplicate', ok: true, submitted: state.submitted };
    if (state.consumed) return rejectPlan('consumed', op?.status);
    if (op && op.status !== 'running') return rejectPlan('turn_settled', op?.status);
    if (managerSnapshot(graph) !== state.snapshot) return rejectPlan('stale_input', op?.status);
    if (state.reviewSnapshot && (await this.reviews(graph, db)).hash !== state.reviewSnapshot)
      return rejectPlan('review_changed', op?.status);
    if ((await this.budgetFacts(graph, db)).blocked)
      return rejectPlan('budget_exhausted', op?.status);
    const unfinished = graph.nodes.filter((n) => n.kind === 'task' && !terminalNodes.has(n.status));
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
    if (plan?.action === 'wait' && unfinished.length)
      return rejectPlan('wait_unsettled', op?.status);
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
   */
  admission = async (
    goalId: string,
    input: { operationId?: string; token?: string } = {},
  ): Promise<GoalPlanContext> => {
    const goal = await new GoalModel(this.db, this.userId, this.workspaceId).findById(goalId);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    const state = goal.config?.managerState;
    const verdict: PlanAdmission =
      state && goal.config?.manager && goal.agentId
        ? await this.evaluateAdmission(this.db, {
            goal,
            operationId: input.operationId ?? state.operationId,
            state,
            token: input.token ?? state.token,
          })
        : rejectPlan('turn_owner');
    const graph =
      verdict.ok && verdict.code === 'ok' ? verdict.graph : await this.graph().getGraph(goalId);
    const budget = graph ? await this.budgetFacts(graph) : undefined;
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
        ...(graph && state ? { current: (await this.reviews(graph)).hash } : {}),
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

  submit = async (goalId: string, token: string, operationId: string, input: GoalPlan) => {
    const plan = goalPlanSchema.parse(input);
    const armed = plan.action === 'wait' ? GoalWaitService.arm(plan.until) : undefined;
    const result = await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      const state = goal?.config?.managerState;
      if (!goal || !state)
        throw new TRPCError({ code: 'FORBIDDEN', message: PLAN_REJECTION.turn_owner.message });
      const admission = await this.evaluateAdmission(db, { goal, operationId, plan, state, token });
      if (!admission.ok)
        throw new TRPCError({ code: admission.trpcCode, message: admission.message });
      if (admission.code === 'duplicate') return { duplicate: true, plan: admission.submitted };
      const { agentId, graph, unfinished } = admission;
      const authored = new GoalGraphModel(db, this.userId, this.workspaceId, {
        id: agentId,
        type: 'agent',
      });
      // Accepting a plan that REPLACES the inherited work has to settle it too.
      // Validation alone was not enough: the blocked node stayed nonterminal, so
      // the next tick's frontier reached it before the corrective node and routed
      // straight back to the Gate, and terminal verification could not start at
      // all. Retiring is the same move the human Gate offers, scoped to the one
      // node this turn was invited about and attributed to the Agent.
      if (
        state.problem &&
        state.problemTaskId &&
        (plan.action === 'tasks' || plan.action === 'verify')
      ) {
        const inherited = graph.nodes.find(
          (n) => n.kind === 'task' && n.taskId === state.problemTaskId,
        );
        // A prerequisite only counts as met when it is `resolved`, so retiring a node
        // that something depends on leaves the dependent blocked forever and the Goal
        // lands on `no_frontier`. Rewiring the dependents onto the replacement would
        // be the answer, but the graph has no edge removal, so the old edge would keep
        // pointing at the retired node. Leave it alone and let the Gate handle it.
        const hasDependents =
          inherited &&
          graph.edges.some(
            (edge) => edge.kind === 'depends_on' && edge.targetNodeId === inherited.id,
          );
        if (inherited && !hasDependents && !terminalNodes.has(inherited.status))
          await authored.updateNodeStatus(goalId, inherited.id, 'retired', plan.reason);
      }
      if (plan.action === 'tasks') {
        // Resolve every reference before writing anything, so a bad one rejects
        // the plan whole instead of leaving half of it on the graph. A prerequisite
        // only counts as met once `resolved`, so a retired or rejected node would
        // block its dependent forever — refuse it here rather than deadlock later.
        // That includes the stuck node a takeover turn is replacing: `graph` is the
        // snapshot from before the retirement above.
        const dependable = new Set(
          graph.nodes
            .filter(
              (n) =>
                n.kind === 'task' &&
                n.status !== 'retired' &&
                n.status !== 'rejected' &&
                !(state.problem && n.taskId === state.problemTaskId),
            )
            .map((n) => n.id),
        );
        plan.tasks.forEach((task, index) => {
          for (const dep of task.dependsOn ?? []) {
            const valid = typeof dep === 'number' ? dep < index : dependable.has(dep);
            if (!valid)
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Task ${index} dependsOn ${JSON.stringify(dep)} is neither an earlier task in this plan nor an active task node of this Goal`,
              });
          }
        });
        const problem = graph.nodes.find((n) => n.kind === 'problem');
        const createdIds: string[] = [];
        for (const { dependsOn: _dependsOn, ...task } of plan.tasks) {
          const node = await authored.createNode(goalId, {
            ...task,
            kind: 'task',
            status: 'proposed',
            createdByAgentId: agentId,
          });
          if (!node) throw new Error('Failed to create a planned task');
          createdIds.push(node.id);
          if (problem) await authored.createEdge(goalId, problem.id, node.id, 'decomposes');
        }
        // Drawn dependent → prerequisite, the direction `selectFrontier` reads a blocker.
        for (const [index, task] of plan.tasks.entries()) {
          for (const dep of new Set(task.dependsOn ?? [])) {
            const prerequisiteId = typeof dep === 'number' ? createdIds[dep] : dep;
            await authored.createEdge(goalId, createdIds[index], prerequisiteId, 'depends_on');
          }
        }
      } else if (plan.action === 'retry') {
        const node = unfinished.find((n) => n.taskId === plan.taskId);
        const task = node
          ? await new TaskModel(db, this.userId, this.workspaceId).findById(plan.taskId)
          : undefined;
        const runs = task
          ? await new TaskTopicModel(db, this.userId, this.workspaceId).findByTaskId(task.id)
          : [];
        const failure = runs[0]?.operationId
          ? await new AgentOperationModel(db, this.userId, this.workspaceId).findById(
              runs[0].operationId,
            )
          : undefined;
        if (
          !task ||
          runs[0]?.operationId !== plan.failedOperationId ||
          !recoveryEligibility(graph, task, failure, false, countUnchargedRuns(runs)).eligible
        )
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Failure identity or retry eligibility changed',
          });
        if (
          !(await new TaskModel(db, this.userId, this.workspaceId).updateStatusIfCurrent(
            task.id,
            'failed',
            'backlog',
            { error: null },
          ))
        )
          throw new TRPCError({ code: 'CONFLICT', message: 'Task changed before retry' });
      } else if (plan.action === 'escalate' && state.problem && plan.ask) {
        // A takeover question is answered on the failed Task's gate, so every
        // answer has to say what happens to that Task — an answer that leaves it
        // failed would only reopen the same gate on the next tick.
        if (plan.ask.options.some((option) => !option.effect))
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Every option of a takeover question needs an effect (retry or retire) for the blocked Task',
          });
      } else if (plan.action === 'escalate' && !state.problem && plan.ask) {
        // A question with answers is asked, not parked: it opens a gate the
        // owner can answer from anywhere, and the answer wakes the next turn.
        const node = await authored.createNode(goalId, {
          description: plan.reason,
          kind: 'decision',
          status: 'waiting',
          title: GOAL_MANAGER_QUESTION_TITLE,
        });
        if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        const problemNode = graph.nodes.find((n) => n.kind === 'problem');
        if (problemNode) await authored.createEdge(goalId, problemNode.id, node.id, 'leads_to');
        const decision = await authored.createDecision(goalId, node.id, {
          authority: 'user',
          options: plan.ask.options,
          question: plan.ask.question,
          recommendedOptionId: plan.ask.recommendedOptionId,
          requestedUserId: this.userId,
        });
        await model.updateStatus(goalId, 'review');
        await authored.recordGoalStatus(goalId, goal.status, 'review', plan.reason);
        if (decision)
          await new GoalBriefService(db, this.userId, this.workspaceId).openDecision(goal, {
            decisionId: decision.id,
            options: decision.options,
            question: decision.question,
            recommendedOptionId: decision.recommendedOptionId,
          });
      } else if (plan.action === 'escalate' && !state.problem) {
        // Only an ORDINARY planning turn pauses the Goal here. A takeover turn has
        // a gate waiting behind it for this exact problem, and the coordinator
        // opens that gate on the next tick — a paused Goal would stop the tick from
        // ever reaching it, leaving the escalation with no answerable question.
        await model.updateStatus(goalId, 'paused');
        await authored.recordGoalStatus(goalId, goal.status, 'paused', plan.reason);
      }
      await this.save(db, goalId, {
        ...state,
        operationId,
        submitted: {
          action: plan.action,
          reason: plan.reason,
          ...(plan.action === 'retry' ? { taskId: plan.taskId } : {}),
          ...(plan.action === 'escalate' && plan.ask ? { ask: plan.ask } : {}),
        },
        readyForAcceptance: plan.action === 'verify',
        replanReason: undefined,
        wait:
          plan.action === 'wait' && armed
            ? { until: plan.until, event: plan.event, armedUntil: armed.armedUntil }
            : undefined,
      });
      return { recorded: true, action: plan.action };
    });
    if (armed && !('duplicate' in result))
      await new GoalWaitService(this.db, this.userId, this.workspaceId).schedule(
        goalId,
        armed.delay,
      );
    return result;
  };
}
