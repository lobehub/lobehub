import { createHash, randomUUID } from 'node:crypto';

import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { buildGoalManagerPrompt } from '@lobechat/prompts';
import type {
  GoalGraphSnapshot,
  GoalManagerState,
  GoalTickResult,
  TaskItem,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { goals } from '@/database/schemas/goal';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { scheduleGoalAdvance } from './scheduler';
import { recoveryEligibility } from './supervisor/policy';

const reason = z.string().trim().min(1).max(8000);
export const goalPlanSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('tasks'),
      reason,
      tasks: z
        .array(z.object({ title: z.string().trim().min(1).max(255), description: reason }))
        .min(1)
        .max(10),
    })
    .strict(),
  z.object({ action: z.literal('verify'), reason }).strict(),
  z
    .object({
      action: z.literal('retry'),
      reason,
      taskId: z.string().min(1),
      failedOperationId: z.string().min(1),
    })
    .strict(),
  z.object({ action: z.literal('escalate'), reason }).strict(),
]);
type GoalPlan = z.infer<typeof goalPlanSchema>;
const activeStatuses = new Set(['planning', 'running']);
const terminalOperations = new Set(['done', 'error', 'interrupted']);
const terminalNodes = new Set(['resolved', 'retired', 'rejected']);
const TIMEOUT_MS = 20 * 60_000;

/** Excludes only the manager's own receipt. Concurrent policy/graph changes invalidate its plan. */
export const managerSnapshot = (graph: GoalGraphSnapshot) => {
  const { managerState: _state, ...config } = graph.goal.config ?? {};
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
    ? { key: state.problem, reason: state.submitted.reason }
    : undefined;

export class GoalManagerService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  usage = async (state?: GoalManagerState) => {
    const operations = state
      ? await new AgentOperationModel(this.db, this.userId, this.workspaceId).listByTopic(
          state.topicId,
          100,
        )
      : [];
    return {
      totalCost: operations.reduce((sum, op) => sum + (Number(op.totalCost) || 0), 0),
      totalTokens: operations.reduce((sum, op) => sum + (op.totalTokens ?? 0), 0),
    };
  };

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

  private reviews = async (graph: GoalGraphSnapshot, db = this.db) => {
    const tasks = new TaskModel(db, this.userId, this.workspaceId);
    const visible = await tasks.findByIds(graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])));
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
      notes: JSON.stringify(
        [...comments]
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
          .slice(-20)
          .map((c) => ({ ...c, content: c.content.slice(0, 2000) })),
      ),
    };
  };

  private budgetBlocked = async (graph: GoalGraphSnapshot, db = this.db) => {
    const spend = await new TaskTopicModel(db, this.userId, this.workspaceId).sumRunCostByTaskIds(
      graph.nodes.flatMap((n) => (n.taskId ? [n.taskId] : [])),
    );
    const management = await new GoalManagerService(db, this.userId, this.workspaceId).usage(
      graph.goal.config?.managerState,
    );
    const goal = graph.goal;
    return (
      (goal.maxRounds !== null && spend.runs >= goal.maxRounds) ||
      (goal.maxTotalCost !== null &&
        spend.totalCost + management.totalCost >= Number(goal.maxTotalCost)) ||
      (!!goal.config?.schedule?.deadline && Date.now() >= Date.parse(goal.config.schedule.deadline))
    );
  };

  private wait = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await scheduleGoalAdvance({
      goalId,
      userId: this.userId,
      workspaceId: this.workspaceId,
      delay: 5,
    });
    return { goalId, outcome: 'waiting_external', message };
  };

  private pause = async (goalId: string, message: string): Promise<GoalTickResult> => {
    await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (goal && activeStatuses.has(goal.status)) {
        await model.updateStatus(goalId, 'paused');
        await this.graph(db).recordGoalStatus(goalId, goal.status, 'paused', message);
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
   * configured this only settles a turn already in flight and otherwise declines.
   * A Goal whose only planner IS the main Agent keeps starting turns here.
   */
  advance = async (
    graph: GoalGraphSnapshot,
    options?: { mayStartTurn?: boolean },
  ): Promise<GoalTickResult | null> => {
    if (!this.eligible(graph)) return null;
    const settled = await this.settleInFlight(graph);
    if (settled) return settled;
    if (options?.mayStartTurn === false) return null;
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

  /** Shared entry conditions: a policy, an active Goal, and nobody waiting on a person. */
  private eligible = (graph: GoalGraphSnapshot) =>
    Boolean(
      graph.goal.config?.manager &&
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
      const operation = await new AgentOperationModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findByTopicSourceMessage(state.topicId, `msg_goal_manager_${state.token}`);
      if (!operation || !terminalOperations.has(operation.status)) {
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
            'Main Agent execution is unconfirmed or timed out. Confirm its exit before resuming; no replacement was dispatched.',
          );
        }
        return this.wait(goal.id, 'Waiting for main Agent CLI planning turn');
      }
      await this.db.transaction(async (db) => {
        const fresh = await new GoalModel(db, this.userId, this.workspaceId).lockById(goal.id);
        if (
          fresh?.config?.managerState?.token === state.token &&
          !fresh.config.managerState.consumed
        ) {
          await this.save(db, goal.id, {
            ...fresh.config.managerState,
            operationId: operation.id,
            consumed: true,
          });
        }
      });
      return {
        goalId: goal.id,
        outcome: 'advanced',
        message: state.submitted
          ? 'Main Agent plan committed; normal Task coordination continues'
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
    return !recoveryEligibility(graph, failed, op).eligible;
  };

  private startTurn = async (
    graph: GoalGraphSnapshot,
    problem?: { reason: string; taskId?: string },
  ): Promise<GoalTickResult | null> => {
    const { goal } = graph;
    const policy = goal.config!.manager!;
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
    if ((state?.turns ?? 0) >= (policy.maxTurns ?? 12) || (await this.budgetBlocked(graph))) {
      // An invited turn declines instead of pausing. The caller was about to open
      // a gate carrying the actual problem; pausing here would replace that
      // question with "the main Agent is out of turns" and lose it.
      if (problem) return null;
      return this.pause(goal.id, 'Goal or main Agent turn budget exhausted');
    }
    const claimed = await this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const fresh = await model.lockById(goal.id);
      if (
        !fresh ||
        !activeStatuses.has(fresh.status) ||
        fresh.config?.managerState?.token !== state?.token ||
        fresh.config?.managerState?.turns !== state?.turns ||
        (fresh.config?.managerState && !fresh.config.managerState.consumed)
      )
        return;
      const current = await this.graph(db).getGraph(goal.id);
      if (!current || managerSnapshot(current) !== managerSnapshot(graph)) return;
      if (
        (fresh.config?.managerState?.turns ?? 0) >= (fresh.config?.manager?.maxTurns ?? 12) ||
        (await this.budgetBlocked(current, db))
      )
        return;
      const topicId =
        state?.topicId ??
        (
          await new TopicModel(db, this.userId, this.workspaceId).create({
            agentId: policy.agentId,
            title: `Goal management: ${goal.title}`,
          })
        ).id;
      const reviews = await this.reviews(current, db);
      const next: GoalManagerState = {
        ...(problem
          ? {
              problem: problemKey(problem),
              ...(problem.taskId && { problemTaskId: problem.taskId }),
            }
          : {}),
        reviewSnapshot: reviews.hash,
        topicId,
        turns: (state?.turns ?? 0) + 1,
        token: randomUUID(),
        snapshot: managerSnapshot(current),
        startedAt: new Date().toISOString(),
      };
      await this.save(db, goal.id, next);
      if (fresh.status === 'planning') await model.updateStatus(goal.id, 'running');
      return { ...next, reviewNotes: reviews.notes };
    });
    if (!claimed) return this.wait(goal.id, 'Another advance owns the planning turn');
    try {
      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).execAgent({
        agentId: policy.agentId,
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
          feedback: claimed.reviewNotes,
          problem: problem?.reason,
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
    }
    return this.wait(goal.id, 'Main Agent dispatched with CLI planning access');
  };

  submit = async (goalId: string, token: string, operationId: string, input: GoalPlan) => {
    const plan = goalPlanSchema.parse(input);
    return this.db.transaction(async (db) => {
      const model = new GoalModel(db, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      const state = goal?.config?.managerState;
      if (!goal?.config?.manager || !state || state.token !== token)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This planning turn does not own the Goal',
        });
      const op = await new AgentOperationModel(
        db,
        this.userId,
        this.workspaceId,
      ).findByTopicSourceMessage(state.topicId, `msg_goal_manager_${token}`);
      if (op?.id !== operationId || op.agentId !== goal.config.manager.agentId)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Unrelated main Agent operation' });
      const graph = await this.graph(db).getGraph(goalId);
      if (
        !graph ||
        !activeStatuses.has(goal.status) ||
        graph.decisions.some((d) => d.status === 'pending')
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Goal stopped or awaiting human decision',
        });
      if (state.submitted) return { duplicate: true, plan: state.submitted };
      if (state.consumed || op.status !== 'running' || managerSnapshot(graph) !== state.snapshot)
        throw new TRPCError({ code: 'CONFLICT', message: 'Stale planning input; no plan applied' });
      if (state.reviewSnapshot && (await this.reviews(graph, db)).hash !== state.reviewSnapshot)
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Task review feedback changed; exit without a plan so the next bounded turn can read it',
        });
      if (await this.budgetBlocked(graph, db))
        throw new TRPCError({ code: 'CONFLICT', message: 'Goal budget exhausted' });
      const unfinished = graph.nodes.filter(
        (n) => n.kind === 'task' && !terminalNodes.has(n.status),
      );
      // A takeover of the terminal acceptance can only be answered with `escalate`.
      // The acceptance task is matched by TITLE regardless of status, so a corrective
      // task returns to that same failed node and `verify` sets `readyForAcceptance`
      // without producing a fresh run — both end at the Gate. Refusing here keeps the
      // prompt's offer and the server's answer the same; letting the acceptance be
      // superseded is a lifecycle change, not a validation one.
      if (
        state.problem &&
        (plan.action === 'tasks' || plan.action === 'verify') &&
        graph.nodes.some(
          (n) =>
            n.kind === 'task' &&
            n.taskId === state.problemTaskId &&
            n.title === GOAL_ACCEPTANCE_TASK_TITLE,
        )
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'A failed Goal acceptance can only be escalated; it cannot be superseded by new work yet',
        });
      // The unfinished-work guard asks whether an UNINVITED turn may plan while
      // work is in flight; it would double-plan the frontier. A takeover turn
      // inherits work that is stuck by definition — the coordinator only handed it
      // over because nothing else moves it — so a corrective task is the answer
      // rather than the thing to forbid. Without this exemption the prompt
      // advertises four actions and only `escalate` can ever commit.
      if (
        (plan.action === 'tasks' || plan.action === 'verify') &&
        ((unfinished.length && !state.problem) ||
          (plan.action === 'verify' &&
            !graph.nodes.some((n) => n.kind === 'task' && n.status === 'resolved')))
      )
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Existing work must be delivered before planning or verification',
        });
      const authored = new GoalGraphModel(db, this.userId, this.workspaceId, {
        id: goal.config.manager.agentId,
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
        const problem = graph.nodes.find((n) => n.kind === 'problem');
        for (const task of plan.tasks) {
          const node = await authored.createNode(goalId, {
            ...task,
            kind: 'task',
            status: 'proposed',
            createdByAgentId: goal.config.manager.agentId,
          });
          if (node && problem) await authored.createEdge(goalId, problem.id, node.id, 'decomposes');
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
          !recoveryEligibility(graph, task, failure).eligible
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
        },
        readyForAcceptance: plan.action === 'verify',
      });
      return { recorded: true, action: plan.action };
    });
  };
}
