import { randomUUID } from 'node:crypto';

import type { GoalItem, GoalManagerState } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';

import { TopicTrigger } from '@/const/topic';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TopicModel } from '@/database/models/topic';
import { GoalRepository } from '@/database/repositories/goal';
import { goals } from '@/database/schemas/goal';

import { TERMINAL_GOAL_STATUSES as finishedGoalStatuses } from '../goalTraceRecorder';
import { DEFAULT_MANAGER_MAX_TURNS } from '../recoveryPolicy';
import { budgetBlocked, reviewFeedback } from './planningInputs';
import {
  activeStatuses,
  goalGraph,
  type ManagerContext,
  managerSnapshot,
  managerTurnToken,
  saveManagerState,
  terminalNodes,
} from './turnState';

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
export const adoptConversationTurn = async (
  ctx: ManagerContext,
  goalId: string,
  run: { operationId: string; topicId: string },
) =>
  ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    if (!goal?.config?.manager) throw new Error('Goal has no main Agent policy to adopt a turn');
    if (goal.config.managerState) throw new Error('Goal already has a planning turn');
    // A local desktop run has no server operation row; the caller already
    // matched its conversation to the goal agent. A recorded run must match too.
    const operation = await new AgentOperationModel(db, ctx.userId, ctx.workspaceId).findById(
      run.operationId,
    );
    if (operation && (operation.topicId !== run.topicId || operation.agentId !== goal.agentId))
      throw new Error('The adopted run does not belong to the goal agent');
    const graph = await goalGraph(ctx, db).getGraph(goalId);
    if (!graph) throw new Error('Goal not found');
    const state: GoalManagerState = {
      adopted: true,
      adoptedOperationId: run.operationId,
      operationId: run.operationId,
      reviewSnapshot: (await reviewFeedback(ctx, graph, db)).hash,
      snapshot: managerSnapshot(graph),
      startedAt: new Date().toISOString(),
      token: randomUUID(),
      topicId: run.topicId,
      turns: 1,
    };
    await saveManagerState(db, goalId, state);
    if (goal.status === 'planning') await model.updateStatus(goalId, 'running');
    return state;
  });

/**
 * Starting a draft is the planning turn's answer. A conversation goal adopts
 * the run that created it as its first turn, and coordination waits for that
 * run to exit — so without this, `start` from inside the run would still
 * dispatch nothing until the run ends. When the draft holds work, the turn is
 * settled here: its arrangement is the plan. An empty draft keeps the turn
 * open so the agent can still submit one. Caller holds the goal row lock.
 */
export const closeTurnOnStart = async (ctx: ManagerContext, goal: GoalItem, hasWork: boolean) => {
  const state = goal.config?.managerState;
  if (!state || state.consumed || !hasWork) return;
  await saveManagerState(ctx.db, goal.id, {
    ...state,
    consumed: true,
    ...(state.submitted
      ? {}
      : {
          startedFromDraft: true,
          submitted: { action: 'tasks', reason: 'Started with the tasks arranged in the draft' },
        }),
  });
};

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
export const moveConversationTo = async (
  ctx: ManagerContext,
  goalId: string,
  agentId: string,
): Promise<GoalManagerState | undefined> =>
  ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    const state = goal?.config?.managerState;
    if (!goal || !state || !state.consumed || goal.agentId !== agentId) return;
    const topicModel = new TopicModel(db, ctx.userId, ctx.workspaceId);
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
    await saveManagerState(db, goalId, next);
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
export const bindTopic = async (
  ctx: ManagerContext,
  goalId: string,
  run: { agentId: string; operationId: string; topicId: string },
  options?: { force?: boolean },
): Promise<{
  goal: GoalItem;
  previousAgentId: string | null;
  previousSubject: { id: string | null; type: GoalItem['subjectType'] };
  turnToken?: string;
}> =>
  ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
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
    if (state && !state.consumed && (state.topicId !== run.topicId || goal.agentId !== run.agentId))
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
      const graph = await goalGraph(ctx, db).getGraph(goalId);
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
        !(await budgetBlocked(ctx, graph, db));
      let next: GoalManagerState;
      if (quiet) {
        // What `adoptConversationTurn` records for a goal created here.
        next = {
          adopted: true,
          adoptedOperationId: run.operationId,
          operationId: run.operationId,
          ...(previousTopicIds.length > 0 && { previousTopicIds }),
          reviewSnapshot: (await reviewFeedback(ctx, graph, db)).hash,
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
      await saveManagerState(db, goalId, next);
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
      await new GoalGraphModel(db, ctx.userId, ctx.workspaceId, {
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
