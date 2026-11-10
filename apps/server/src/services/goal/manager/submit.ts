import { GOAL_MANAGER_QUESTION_TITLE, ROLLOUT_MAX_CANARY_SIZE } from '@lobechat/const/goal';
import type { GoalItem, GoalManagerState } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { GoalBriefService } from '../goalBriefs';
import { countUnchargedRuns } from '../recoveryPolicy';
import {
  materializeRolloutBatch,
  MAX_ROLLOUT_ROSTER,
  normalizeRolloutRoster,
} from '../rolloutBatch';
import { recoveryEligibility } from '../supervisor/policy';
import { GoalWaitService } from '../wait';
import { evaluateAdmission, PLAN_REJECTION } from './admission';
import { type GoalPlan, goalPlanSchema, type planRolloutSchema } from './planSchema';
import { type ManagerContext, saveManagerState, terminalNodes } from './turnState';

/**
 * Lay a main Agent's declared batch onto the graph, returning the probe node
 * IDs in the order of `plan.tasks`. Refuses — before anything is written — a
 * declaration the Goal's own policy or state cannot carry: rollout turned off,
 * a takeover turn, a batch already in flight, or a probe/roster size outside
 * what the gate and the waves can deliver whole.
 */
const declareBatch = async (
  ctx: ManagerContext,
  db: LobeChatDatabase,
  input: {
    agentId: string;
    goal: GoalItem;
    plan: Extract<GoalPlan, { action: 'tasks' }> & {
      rollout: z.infer<typeof planRolloutSchema>;
    };
    problemId?: string;
    state: GoalManagerState;
    writer: GoalGraphModel;
  },
): Promise<string[]> => {
  const { agentId, goal, plan, problemId, state, writer } = input;
  const refuse = (message: string, code: 'BAD_REQUEST' | 'CONFLICT' = 'BAD_REQUEST') => {
    throw new TRPCError({ code, message });
  };
  const policy = goal.config?.rollout;
  const trigger = policy?.trigger ?? 'canary';
  if (trigger === 'off')
    refuse('This Goal has rollout turned off; submit the units as ordinary tasks');
  if (state.problem) refuse('A takeover turn cannot open a batch; answer the problem it names');
  const active = goal.config?.rolloutState;
  if (active && active.phase !== 'done')
    refuse('A batch is already in flight; let its gate and waves finish first', 'CONFLICT');
  if (!problemId) refuse('The Goal has no problem node to hang a batch on');
  const maxProbes = trigger === 'full' ? 10 : ROLLOUT_MAX_CANARY_SIZE;
  if (plan.tasks.length < 2 || plan.tasks.length > maxProbes)
    refuse(`A batch runs 2-${maxProbes} probe tasks before its gate; got ${plan.tasks.length}`);

  const units = plan.rollout.units.map((unit) =>
    typeof unit === 'string' ? { title: unit } : unit,
  );
  const roster = normalizeRolloutRoster(
    units.map((unit) => unit.title),
    plan.tasks,
    plan.tasks.length,
    Number.POSITIVE_INFINITY,
  );
  if (roster.length > MAX_ROLLOUT_ROSTER)
    refuse(
      `A batch roster holds at most ${MAX_ROLLOUT_ROSTER} units; got ${roster.length}. Split the work into more than one Goal`,
    );
  if (roster.length <= plan.tasks.length)
    refuse('The batch roster has no units beyond its probes; submit ordinary tasks instead');

  const unitBriefs = Object.fromEntries(
    units.flatMap((unit) =>
      'description' in unit && unit.description ? [[unit.title, unit.description]] : [],
    ),
  );
  const { probeIds } = await materializeRolloutBatch({
    canarySize: plan.tasks.length,
    createdByAgentId: agentId,
    goalId: goal.id,
    goalModel: new GoalRepository(db, ctx.userId, ctx.workspaceId),
    planSkillOwner: {
      db,
      goalTitle: goal.title,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    },
    policy,
    problemId: problemId!,
    probes: plan.tasks.map((task) => ({ instruction: task.description, title: task.title })),
    recipeOutline: plan.rollout.recipe,
    repeatable: true,
    roster,
    trigger: trigger === 'full' ? 'full' : 'canary',
    unitBriefs,
    variants: plan.rollout.variants,
    writer,
  });
  return probeIds;
};

export const submitPlan = async (
  ctx: ManagerContext,
  goalId: string,
  token: string,
  operationId: string,
  input: GoalPlan,
) => {
  const plan = goalPlanSchema.parse(input);
  const armed = plan.action === 'wait' ? GoalWaitService.arm(plan.until) : undefined;
  const result = await ctx.db.transaction(async (db) => {
    const model = new GoalRepository(db, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    const state = goal?.config?.managerState;
    if (!goal || !state)
      throw new TRPCError({ code: 'FORBIDDEN', message: PLAN_REJECTION.turn_owner.message });
    const admission = await evaluateAdmission(ctx, db, { goal, operationId, plan, state, token });
    if (!admission.ok)
      throw new TRPCError({ code: admission.trpcCode, message: admission.message });
    if (admission.code === 'duplicate') return { duplicate: true, plan: admission.submitted };
    const { agentId, graph, unfinished } = admission;
    const authored = new GoalGraphModel(db, ctx.userId, ctx.workspaceId, {
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
      if (plan.rollout) {
        const probeIds = await declareBatch(ctx, db, {
          agentId,
          goal,
          plan: { ...plan, rollout: plan.rollout },
          problemId: problem?.id,
          state,
          writer: authored,
        });
        createdIds.push(...probeIds);
      }
      for (const { dependsOn: _dependsOn, ...task } of plan.rollout ? [] : plan.tasks) {
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
        ? await new TaskModel(db, ctx.userId, ctx.workspaceId).findById(plan.taskId)
        : undefined;
      const runs = task
        ? await new TaskTopicModel(db, ctx.userId, ctx.workspaceId).findByTaskId(task.id)
        : [];
      const failure = runs[0]?.operationId
        ? await new AgentOperationModel(db, ctx.userId, ctx.workspaceId).findById(
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
        !(await new TaskModel(db, ctx.userId, ctx.workspaceId).updateStatusIfCurrent(
          task.id,
          'failed',
          'backlog',
          { error: null },
        ))
      )
        throw new TRPCError({ code: 'CONFLICT', message: 'Task changed before retry' });
    } else if (plan.action === 'release') {
      // The approval lands with the plan, under the same lock; the coordinator
      // releases the wave on its next advance. It names the round and wave the
      // gate passed for, so it can never release a later one.
      const rollout = goal.config?.rolloutState;
      if (!rollout || rollout.phase === 'done' || rollout.phase === 'pattern_break')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The batch is no longer waiting on a release',
        });
      await model.updateRolloutState(goalId, {
        ...rollout,
        releaseApproval: {
          at: new Date().toISOString(),
          by: 'agent',
          reason: plan.reason,
          revision: rollout.templateRevision,
          waveIndex: rollout.waveIndex,
        },
      });
    } else if (plan.action === 'revise_plan' && state.problemKind === 'rollout_distill') {
      // The plan distilled from the settled probes lands with the plan; the next
      // advance writes it as the plan skill's next version, then judges the gate
      // — or first re-runs the probes the Agent found falling short of it.
      const rollout = goal.config?.rolloutState;
      if (rollout?.phase !== 'plan_distill')
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The batch is no longer waiting on a plan distilled from its probes',
        });
      await model.updateRolloutState(goalId, {
        ...rollout,
        pendingDistill: {
          reason: plan.reason,
          recipe: plan.recipe,
          ...(plan.rerun?.length && { rerun: plan.rerun }),
        },
      });
    } else if (plan.action === 'revise_plan') {
      // The rewrite lands with the plan; the next advance re-runs the units it names.
      const rollout = goal.config?.rolloutState;
      if (rollout?.phase !== 'plan_revision' || !rollout.pendingRevision)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The batch is no longer waiting on a plan revision',
        });
      await model.updateRolloutState(goalId, {
        ...rollout,
        pendingRevision: {
          ...rollout.pendingRevision,
          ...(plan.rerun && { rerun: plan.rerun }),
          revisedReason: plan.reason,
          revisedRecipe: plan.recipe,
        },
      });
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
        requestedUserId: ctx.userId,
      });
      await model.updateStatus(goalId, 'review');
      await authored.recordGoalStatus(goalId, goal.status, 'review', plan.reason);
      if (decision)
        await new GoalBriefService(db, ctx.userId, ctx.workspaceId).openDecision(goal, {
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
    await saveManagerState(db, goalId, {
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
    await new GoalWaitService(ctx.db, ctx.userId, ctx.workspaceId).schedule(goalId, armed.delay);
  return result;
};
