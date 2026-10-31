import { createHash, randomUUID } from 'node:crypto';

import type { GoalGraphSnapshot, GoalManagerState } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { goals } from '@/database/schemas/goal';
import type { LobeChatDatabase } from '@/database/type';

/** The owner a manager operation runs as; every extracted stage takes it explicitly. */
export interface ManagerContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export const activeStatuses = new Set(['planning', 'running']);
export const terminalNodes = new Set(['resolved', 'retired', 'rejected']);
/** Source message id prefix of a dispatched planning turn; the suffix is its token. */
export const MANAGER_SOURCE_MESSAGE_PREFIX = 'msg_goal_manager_';

/**
 * The token a planning turn is keyed by, carrying the Goal it belongs to.
 *
 * The source message `msg_goal_manager_<token>` is the only durable link from a
 * manager operation back to its Goal, so the Goal id has to sit inside it for
 * management spend to be attributable. Without it, a conversation this Goal was
 * moved out of — which can be a normal conversation that later supervised
 * another Goal — would charge that other Goal's turns to this one's budget.
 */
export const managerTurnToken = (goalId: string) => `${goalId}_${randomUUID()}`;

/**
 * Excludes only the manager's own receipt. Concurrent policy/graph changes
 * invalidate its plan.
 *
 * Node rows are projected, not hashed whole: `updatedAt` is bookkeeping that a
 * same-status rewrite bumps without changing any planning input, and hashing it
 * made an in-flight planning turn go stale whenever a background loop rewrote a
 * node it did not own (a coordinator retry re-activating an already-active task
 * rejected every submit with "Stale planning input" until the turn expired).
 */
export const managerSnapshot = (graph: GoalGraphSnapshot) => {
  // Coordinator receipts are not planning input: arming a Task's quota wake while a
  // turn runs must not make that turn's plan stale, and neither may the system
  // planner's lease — a hand-over starts the turn while the lease is still held
  // and releases it right after.
  const {
    managerState: _state,
    planningCheckpoint: _lease,
    quotaRetryWakeAt: _quotaWake,
    ...config
  } = graph.goal.config ?? {};
  return createHash('sha256')
    .update(
      JSON.stringify({
        requirement: graph.goal.requirement,
        config,
        maxRounds: graph.goal.maxRounds,
        maxTotalCost: graph.goal.maxTotalCost,
        nodes: graph.nodes.map(({ updatedAt: _updatedAt, ...planning }) => planning),
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

/** A takeover problem is identified by the task it blocked, not by its wording
 *  alone: "Task attempt budget was exhausted" is the same sentence for every task
 *  that reaches it, so a reason-only key makes the second task inherit the first
 *  one's answer. */
/** A problem the coordinator hands to the main Agent instead of stopping on a person. */
export interface GoalTakeoverProblem {
  /** `rollout_release`: a passed batch gate whose next wave the Agent releases or escalates. */
  kind?: GoalManagerState['problemKind'];
  reason: string;
  taskId?: string;
}

export const problemKey = (problem: GoalTakeoverProblem) =>
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

/**
 * The operation that is the current planning turn. A dispatched turn is found
 * by the source message the manager minted for it; an adopted turn — the
 * conversation run that created the goal — never had one, so it is the
 * operation recorded at adoption.
 */
export const turnOperation = async (operations: AgentOperationModel, state: GoalManagerState) =>
  state.adopted
    ? state.operationId
      ? ((await operations.findById(state.operationId)) ?? undefined)
      : undefined
    : operations.findByTopicSourceMessage(
        state.topicId,
        `${MANAGER_SOURCE_MESSAGE_PREFIX}${state.token}`,
      );

export const saveManagerState = async (
  db: LobeChatDatabase,
  id: string,
  state: GoalManagerState,
) => {
  // Caller holds the owned Goal row lock. Do not overwrite concurrent policy namespaces.
  await db
    .update(goals)
    .set({
      config: sql`jsonb_set(COALESCE(${goals.config}, '{}'::jsonb), '{managerState}', ${JSON.stringify(state)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, id));
};

export const goalGraph = (ctx: ManagerContext, db = ctx.db) =>
  new GoalGraphModel(db, ctx.userId, ctx.workspaceId);
