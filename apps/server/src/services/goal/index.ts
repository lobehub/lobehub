import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import { buildGoalRequirement } from '@lobechat/builtin-tool-goal';
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import type {
  GoalConfig,
  GoalEdgeKind,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
  GoalNodeKind,
  GoalNodeStatus,
  GoalStatus,
  GoalTickResult,
  TaskItem,
  TaskTopicHandoff,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';

import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { AcceptanceService } from '../verify/acceptanceService';
import { VerifyPlanGeneratorService } from '../verify/planGenerator';
import { GoalCriteriaGeneratorService, type GoalDecompositionDraft } from './criteriaGenerator';
import {
  decideNextMove,
  frontierNeedsBudget,
  GOAL_ACCEPTANCE_TASK_TITLE,
  type GoalMove,
  LEASE_EXPIRED_ERROR,
  selectFrontier,
  TERMINAL_NODE_STATUSES,
} from './decideNextMove';
import {
  resolveMaxConcurrentTasks,
  resolveOperationLeaseTimeout,
  resolveTaskMaxSteps,
  VERIFY_SETTLE_GRACE_MS,
} from './recoveryPolicy';
import { TaskRecoveryCoordinator } from './taskRecoveryCoordinator';
import {
  type GoalTickOptions,
  toBudgetState,
  toFrontierTaskState,
  toTraceGraphState,
} from './traceObservation';

const TASK_NODE_CLAIM_TTL_MS = 5 * 60 * 1000;
const TASK_DESCRIPTION_MAX_LENGTH = 255;
/** Advisory-lock namespace for goal dispatch. `0x676f_6469` is ASCII `godi`. */
const GOAL_DISPATCH_LOCK_NAMESPACE = 0x67_6f_64_69;

export interface CreateGoalTaskInput {
  description?: string;
  title: string;
}

export interface CreateGoalGraphInput {
  agentId?: string;
  config?: GoalConfig;
  /**
   * The agent that made this call, when a tool did. Distinct from `agentId`,
   * which is the agent the goal is assigned to — creating a goal from the modal
   * on an agent's page sets that, but the author is still the person.
   */
  createdByAgentId?: string;
  /**
   * Structured acceptance criteria. Persisted as `verify_criteria` rows and
   * recorded on `config.acceptance.criteriaIds`, so the goal page can show and
   * edit them and the terminal Goal-acceptance Task verifies against exactly
   * these checks. Callers still fold the same criteria into `requirement`
   * prose — that text remains what every Task's execution context reads.
   */
  criteria?: Array<{ description?: string; instruction?: string; title: string }>;
  maxRounds?: number;
  maxTotalCost?: number;
  /**
   * The user's ask in their own words, shown on the seeded problem node. The
   * full `requirement` (with its acceptance boilerplate) stays on the goal row
   * — copying it onto the node made every drill-down read like a contract.
   */
  problemDescription?: string;
  projectId?: string;
  requirement?: string;
  /**
   * Seed task nodes, in dependency-free order. A plain string is title-only.
   * When omitted, the coordinator plans the decomposition on first advance.
   */
  tasks?: Array<CreateGoalTaskInput | string>;
  title: string;
}

export interface CreateGoalNodeInput {
  description?: string;
  kind: GoalNodeKind;
  priority?: number;
  status?: GoalNodeStatus;
  title: string;
}

/** Application service shared by CLI today and Graph UI/schedulers later. */
export class GoalService {
  private readonly acceptanceService: AcceptanceService;
  private readonly goalModel: GoalModel;
  /**
   * Graph writes attributed to the person who asked for them: seeding a goal,
   * adding a node or edge by hand, resolving a decision gate.
   */
  private readonly graphModel: GoalGraphModel;
  /**
   * Graph writes the coordinator makes on its own — claiming a Task node,
   * binding its task, synthesizing a finding, opening a gate. Attributed to the coordinator
   * even when a person pressed Advance: they asked it to run, they did not make
   * these moves.
   */
  private readonly coordinatorGraph: GoalGraphModel;
  private readonly taskModel: TaskModel;
  private readonly taskService: TaskService;
  private readonly taskTopicModel: TaskTopicModel;
  private readonly workModel: WorkModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.acceptanceService = new AcceptanceService(db, userId, workspaceId);
    this.goalModel = new GoalModel(db, userId, workspaceId);
    this.graphModel = new GoalGraphModel(db, userId, workspaceId);
    this.coordinatorGraph = new GoalGraphModel(db, userId, workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskService = new TaskService(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.workModel = new WorkModel(db, userId, workspaceId);
  }

  /**
   * The graph model whose audit trail names `agentId` as the author, or the
   * user-attributed one when a person is calling.
   */
  private graphAs = (agentId?: string) =>
    agentId
      ? new GoalGraphModel(this.db, this.userId, this.workspaceId, { id: agentId, type: 'agent' })
      : this.graphModel;

  create = async (input: CreateGoalGraphInput): Promise<GoalGraphSnapshot> => {
    if (input.agentId) {
      await assertAgentUsableBy(this.db, input.agentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }
    if (input.projectId) {
      const project = await new ProjectModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).findManageableById(input.projectId);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }
    // Persist the structured acceptance criteria first: their ids ride on the
    // goal config so the page can edit them and the terminal acceptance Task
    // is gated on exactly these checks (not an AI re-derivation of the prose).
    let config = input.config;
    let requirement = input.requirement;
    if (input.criteria?.length) {
      // The prose requirement must keep carrying the full standard (the goal
      // page's 什么算完成 block and every Task's execution context read it).
      // Callers normally compose it via `buildGoalRequirement`; guard API
      // callers that pass criteria with a bare requirement.
      const carriesCriteria = input.criteria.every((item) =>
        input.requirement?.includes(item.title),
      );
      if (!carriesCriteria) {
        requirement = buildGoalRequirement(input.title, input.criteria, input.requirement);
      }
    }
    if (input.criteria?.length) {
      const criteriaIds = await new VerifyPlanGeneratorService(
        this.db,
        this.userId,
        this.workspaceId,
      ).createCriteriaFromDrafts(
        input.criteria.map((item) => ({
          description: item.description,
          instruction: item.instruction,
          onFail: 'manual',
          required: true,
          title: item.title,
          verifierType: 'agent',
        })),
      );
      config = { ...config, acceptance: { criteriaIds } };
    }

    const goal = await this.goalModel.create({
      agentId: input.agentId,
      config,
      maxRounds: input.maxRounds,
      maxTotalCost: input.maxTotalCost,
      projectId: input.projectId,
      requirement,
      subjectType: 'standalone',
      title: input.title,
    });
    // `/goal` is an agent making the call. Seeding through the user-attributed
    // model would file the whole opening graph under the goal's owner, which is
    // the same loss of authorship the coordinator split just fixed.
    const authorGraph = this.graphAs(input.createdByAgentId);

    try {
      const problem = await authorGraph.createNode(goal.id, {
        createdByAgentId: input.createdByAgentId,
        description: input.problemDescription ?? input.requirement,
        kind: 'problem',
        status: 'active',
        title: input.title,
      });
      if (!problem) throw new Error('Failed to seed goal problem');

      for (const seed of input.tasks ?? []) {
        const { description, title } = typeof seed === 'string' ? { title: seed } : seed;
        const taskNode = await authorGraph.createNode(goal.id, {
          createdByAgentId: input.createdByAgentId,
          description,
          kind: 'task',
          title,
        });
        if (!taskNode) throw new Error('Failed to seed goal task');
        await authorGraph.createEdge(goal.id, problem.id, taskNode.id, 'decomposes');
      }
    } catch (error) {
      await this.goalModel.delete(goal.id).catch(() => {});
      throw error;
    }
    return (await this.graphModel.getGraph(goal.id))!;
  };

  /**
   * Replace the goal's structured acceptance criteria id list (goal-page
   * editing). The criteria rows themselves are edited through the verify
   * criteria endpoints; this only rebinds which of them gate the goal.
   */
  setAcceptanceCriteria = async (goalId: string, criteriaIds: string[]) => {
    const goal = await this.goalModel.findById(goalId);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    await this.goalModel.update(goalId, {
      config: { ...goal.config, acceptance: { criteriaIds } },
    });

    // A terminal Goal-acceptance Task may already be dispatched — its
    // Acceptance row snapshotted the previous id list. Rebind it too, or the
    // page would present the new criteria as gates while the verifier keeps
    // materializing plans from the stale list. A verify round already
    // materialized for an in-flight run stays as-is (rounds are immutable
    // snapshots); every later run instantiates from the updated config.
    const graph = await this.graphModel.getGraph(goalId);
    const terminalTaskId = graph?.nodes.find(
      (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE && node.taskId,
    )?.taskId;
    if (!terminalTaskId) return;

    const acceptance = await this.acceptanceService.acceptanceModel.findBySubject(
      'task',
      terminalTaskId,
    );
    if (!acceptance || acceptance.status === 'accepted') return;
    await this.acceptanceService.acceptanceModel.update(acceptance.id, {
      config: {
        ...acceptance.config,
        ...(criteriaIds.length > 0
          ? { verifyCriteriaIds: criteriaIds }
          : { verifyCriteriaIds: undefined }),
      },
    });
  };

  graph = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    return { ...graph, runHeartbeats: await this.collectRunHeartbeats(graph) };
  };

  /**
   * Live heartbeat per active task node: the `agent_operations.updatedAt` of
   * the run behind it. The runtime refreshes that lease every ~90s while
   * `goal_nodes.updatedAt` only moves on observations / status changes, so a
   * client judging liveness from the node row alone would cry "lost" over any
   * long quiet stretch (a big tool call, the verify stage) the reclaim path
   * considers perfectly healthy.
   */
  private collectRunHeartbeats = async (
    graph: GoalGraphSnapshot,
  ): Promise<Record<string, Date> | undefined> => {
    const activeTasks = graph.nodes.filter(
      (node): node is GoalGraphNode & { taskId: string } =>
        node.kind === 'task' && node.status === 'active' && !!node.taskId,
    );
    if (activeTasks.length === 0) return undefined;

    const nodeByTaskId = new Map(activeTasks.map((node) => [node.taskId, node.id]));
    const running = await this.taskTopicModel.findRunningByTaskIds(
      activeTasks.map((n) => n.taskId),
    );

    // One batched read: the graph polls every few seconds per open client, so
    // a per-topic operation lookup would scale queries with task concurrency.
    const operationIds = [
      ...new Set(running.flatMap((topic) => (topic.operationId ? [topic.operationId] : []))),
    ];
    const operations = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findByIds(operationIds);
    const operationById = new Map(operations.map((operation) => [operation.id, operation]));

    const heartbeats: Record<string, Date> = {};
    for (const topic of running) {
      const nodeId = topic.taskId ? nodeByTaskId.get(topic.taskId) : undefined;
      if (!nodeId || !topic.operationId || heartbeats[nodeId]) continue;
      const updatedAt = operationById.get(topic.operationId)?.updatedAt;
      if (updatedAt) heartbeats[nodeId] = updatedAt;
    }

    return Object.keys(heartbeats).length > 0 ? heartbeats : undefined;
  };

  /** Current lifecycle status, without paying for the whole graph. */
  status = async (goalId: string): Promise<GoalStatus | undefined> =>
    (await this.goalModel.findById(goalId))?.status;

  addNode = async (goalId: string, input: CreateGoalNodeInput) => {
    const node = await this.graphModel.createNode(goalId, input);
    if (!node) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return node;
  };

  addEdge = async (
    goalId: string,
    sourceNodeId: string,
    targetNodeId: string,
    kind: GoalEdgeKind,
  ) => {
    const edge = await this.graphModel.createEdge(goalId, sourceNodeId, targetNodeId, kind);
    if (!edge) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return edge;
  };

  /**
   * Stop everything the goal has running, then delete it and its graph.
   *
   * Deleting only the goal row cascades the graph away but leaves each graph
   * Task — and the agent operation behind it — running, spending the user's
   * budget with nothing left on screen to stop it. The tasks themselves stay:
   * they are ordinary tasks with their own history and acceptance.
   */
  delete = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    const taskIds = graph?.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])) ?? [];

    for (const taskId of taskIds) {
      const topics = await this.taskTopicModel.findByTaskId(taskId);
      for (const topic of topics) {
        if (topic.status !== 'running' || !topic.topicId) continue;
        // Deliberately not swallowed. Interrupting can fail — the runtime or a
        // device gateway may be unreachable — and going ahead would delete the
        // only surface that can stop an operation which keeps spending. Better
        // to leave the goal intact and say so.
        try {
          await this.taskService.cancelTopic(topic.topicId);
        } catch (error) {
          throw new TRPCError({
            cause: error,
            code: 'PRECONDITION_FAILED',
            message:
              'Could not stop the work still running for this goal, so it was not deleted. Try again once the run is reachable.',
          });
        }
      }
      await this.taskModel
        .updateStatusIfCurrent(taskId, 'running', 'paused')
        .catch((error) => console.error('[GoalService.delete] failed to pause task:', error));
    }

    return this.goalModel.delete(goalId);
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
  private transitionStatus = async (
    goal: GoalItem,
    to: GoalStatus,
    reason?: string,
    actor: 'coordinator' | 'user' = 'coordinator',
  ): Promise<GoalItem | undefined> => {
    if (goal.status === to) return goal;
    const updated = await this.goalModel.updateStatus(goal.id, to);
    if (!updated) return undefined;
    const model = actor === 'coordinator' ? this.coordinatorGraph : this.graphModel;
    await model
      .recordGoalStatus(goal.id, goal.status, to, reason)
      .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    return updated;
  };

  pause = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    const goal = await this.transitionStatus(graph.goal, 'paused', 'paused by user', 'user');
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  /**
   * What the goal has spent against what it is allowed to spend.
   *
   * Rounds are counted across every Task in the graph, not per Task — the
   * budget is the goal's, so `setBudget` has to read it exactly the way the
   * coordinator does or raising a budget would not reliably unstick a goal.
   *
   * The calendar-time budget (schedule.deadline) is evaluated in the same
   * shape: time is the long-horizon budget unit the attempt/round/dollar trio
   * cannot express, and a goal whose deadline passed must stop the same way a
   * goal out of money does.
   */
  private evaluateBudget = async (goal: GoalItem, graph: GoalGraphSnapshot) => {
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
    const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
    const deadline = goal.config?.schedule?.deadline ?? null;
    return {
      costLimitReached: goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost),
      deadline,
      deadlinePassed: deadline !== null && Date.now() >= new Date(deadline).getTime(),
      roundLimitReached: goal.maxRounds !== null && runs.length >= goal.maxRounds,
      runs,
      totalCost,
    };
  };

  /**
   * Edit the goal's standing acceptance requirement in place. The next
   * coordinator move and every later dispatched Task read the updated text;
   * an already-running Task keeps the contract it was dispatched with.
   */
  updateRequirement = async (goalId: string, requirement: string) => {
    const goal = await this.goalModel.update(goalId, { requirement });
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  setBudget = async (
    goalId: string,
    budget: {
      deadline?: string | null;
      maxRounds?: number | null;
      maxTotalCost?: number | null;
    },
  ) => {
    const before = await this.requireGraph(goalId);
    const wasBinding = await this.evaluateBudget(before.goal, before);

    // Deadline joins the two execution budgets on the goal row's config; null
    // clears it. The merge keeps an untouched recovery/schedule block intact.
    const config = { ...before.goal.config };
    if (budget.deadline !== undefined || config.schedule) {
      config.schedule = { ...config.schedule, deadline: budget.deadline ?? null };
    }

    const goal = await this.goalModel.update(goalId, {
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
    if (goal.status !== 'paused' || !stoppedByBudget) return goal;

    const nowBinding = await this.evaluateBudget(goal, before);
    if (nowBinding.costLimitReached || nowBinding.roundLimitReached || nowBinding.deadlinePassed) {
      return goal;
    }

    return (await this.resume(goalId)) ?? goal;
  };

  resume = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    const status = graph.decisions.some((decision) => decision.status === 'pending')
      ? 'review'
      : 'running';
    const goal = await this.transitionStatus(graph.goal, status, 'resumed by user', 'user');
    return goal ?? graph.goal;
  };

  decide = async (goalId: string, decisionId: string, optionId: string, resolution?: string) => {
    const graph = await this.requireGraph(goalId);
    const decision = graph.decisions.find((item) => item.id === decisionId);
    if (!decision || decision.status !== 'pending') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pending decision not found' });
    }
    if (decision.options?.length && !decision.options.some((option) => option.id === optionId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown decision option' });
    }
    const resolved = await this.graphModel.resolveDecision(
      goalId,
      decisionId,
      optionId,
      resolution,
    );
    if (!resolved)
      throw new TRPCError({ code: 'CONFLICT', message: 'Decision was already resolved' });

    const incoming = graph.edges.find(
      (edge) => edge.targetNodeId === decision.nodeId && edge.kind === 'leads_to',
    );
    const source = incoming && graph.nodes.find((node) => node.id === incoming.sourceNodeId);
    if (source?.kind === 'task') {
      if (optionId === 'retry' && source.taskId) {
        await this.taskModel.updateStatus(source.taskId, 'backlog', { error: null });
        await this.graphModel.updateNodeStatus(goalId, source.id, 'active', resolution);
      } else if (
        optionId === 'retire' ||
        (optionId === 'fail' && source.title === GOAL_ACCEPTANCE_TASK_TITLE)
      ) {
        await this.graphModel.updateNodeStatus(goalId, source.id, 'retired', resolution);
      }
    }
    const terminalAcceptanceFailed =
      source?.title === GOAL_ACCEPTANCE_TASK_TITLE &&
      (optionId === 'retire' || optionId === 'fail');
    await this.transitionStatus(
      graph.goal,
      terminalAcceptanceFailed ? 'failed' : 'running',
      `decision "${decision.question}" resolved: ${optionId}`,
    );
    return resolved;
  };

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
  tick = async (goalId: string, options?: GoalTickOptions): Promise<GoalTickResult> => {
    const at = Date.now();
    const graph = await this.requireGraph(goalId);
    const frontier = selectFrontier(graph);

    // Every candidate's task, not just the head's: the scheduler has to know
    // which of them are in flight before it can decide what else to start.
    const candidateTaskIds = frontier.eligible.flatMap(({ node }) =>
      node.taskId ? [node.taskId] : [],
    );
    const tasksById = new Map(
      (candidateTaskIds.length > 0 ? await this.taskModel.findByIds(candidateTaskIds) : []).map(
        (task) => [task.id, task],
      ),
    );

    // Asked of every unblocked candidate, not just the head: the scheduler
    // walks past a running head to start an independent task, so a head that
    // needs no budget must not decide that nothing does. A goal with nothing
    // startable still skips the query.
    const budget = frontierNeedsBudget(frontier, tasksById)
      ? toBudgetState(graph.goal, await this.evaluateBudget(graph.goal, graph))
      : undefined;

    const concurrency = resolveMaxConcurrentTasks(graph.goal);
    const move = decideNextMove({
      budget,
      concurrency,
      frontier,
      graph,
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
        await this.transitionStatus(graph.goal, 'review', 'a decision gate is open');
        effects.push({ type: 'goal_status', detail: 'review' });
        return observe({
          goalId,
          message: move.message,
          nodeId: move.focusNodeId,
          outcome: move.outcome,
        });
      }

      case 'terminal_acceptance': {
        return observe(await this.settleTerminalAcceptance(graph, move, effects));
      }

      case 'plan_decomposition': {
        return observe(await this.planDecomposition(graph, effects));
      }

      case 'no_frontier': {
        // Say so on the row instead of leaving a goal that reads as `running`
        // while it cannot run — and, just as importantly, take it out of the
        // sweep's window. A `running` goal that always reports `no_progress` is
        // picked by every scan forever, and enough of them starve every other
        // stalled goal out of the newest-first limit.
        await this.transitionStatus(graph.goal, 'paused', 'no eligible task to advance');
        effects.push({ type: 'goal_status', detail: 'paused' });
        return observe({ goalId, message: move.message, outcome: move.outcome });
      }

      case 'create_task': {
        return observe(await this.createResponsibleTask(graph, acting!, effects));
      }

      case 'missing_task': {
        await this.coordinatorGraph.updateNodeStatus(
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
        await this.ensureTaskWorkVersion(graph.goal.id, acting!.id, task.id);

        switch (move.branch) {
          case 'consume_completed': {
            return observe(await this.consumeCompletedTask(graph, acting!.id, task.id, effects));
          }

          case 'recover_lease': {
            return observe(
              await this.resumeAbandonedTaskRecovery(graph, acting!.id, task, effects),
            );
          }

          case 'recover_verification': {
            return observe(await this.recoverAfterVerification(graph, acting!.id, task, effects));
          }

          case 'failure_decision': {
            return observe(
              await this.openFailureDecision(graph, acting!.id, task.id, move.message, effects),
            );
          }

          case 'task_paused': {
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
              const recovered = await this.recoverAbandonedTask(graph, acting!.id, task, effects);
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
            await this.transitionStatus(graph.goal, 'paused', move.message);
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
            return observe(await this.dispatchWork(graph, acting!.id, task, effects));
          }
        }
      }
    }
  };

  /**
   * Create the Goal-level acceptance Task, or read the verdict it already
   * reached. Only runs once every other Task is terminal.
   */
  private settleTerminalAcceptance = async (
    graph: GoalGraphSnapshot,
    move: GoalMove,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;

    if (move.outcome === 'achieved') {
      // The map must agree with the verdict: only task nodes get resolved as
      // Tasks complete, so without this the seeded problem nodes would read
      // "active / unanswered" forever on an achieved goal.
      for (const node of graph.nodes) {
        if (node.kind !== 'problem' || TERMINAL_NODE_STATUSES.has(node.status)) continue;
        await this.coordinatorGraph.updateNodeStatus(goalId, node.id, 'resolved', 'Goal achieved');
        effects.push({ detail: 'resolved', nodeId: node.id, type: 'node_status' });
      }
      await this.transitionStatus(graph.goal, 'achieved', 'Goal-level acceptance passed');
      effects.push({ type: 'goal_status', detail: 'achieved' });
      return { goalId, message: move.message, outcome: 'achieved' };
    }

    if (move.outcome === 'no_progress') {
      return { goalId, message: move.message, nodeId: move.focusNodeId, outcome: 'no_progress' };
    }

    const result = await this.coordinatorGraph.createNodeOnce(goalId, {
      description: [
        `Complete and prove the overall Goal acceptance requirement: ${graph.goal.requirement}`,
        'Inspect and reuse existing Goal findings, artifacts, metrics, and command results as the primary evidence. Do not repeat expensive or destructive work when the existing evidence is sufficient and still auditable.',
        'Explicitly close every remaining acceptance gap instead of treating completed upstream Tasks as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.',
        'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.',
      ].join('\n\n'),
      kind: 'task',
      priority: -1,
      title: GOAL_ACCEPTANCE_TASK_TITLE,
    });
    if (!result) {
      return {
        goalId,
        message: 'Could not create the Goal-level acceptance Task',
        outcome: 'no_progress',
      };
    }
    if (result.created) {
      effects.push({ nodeId: result.node.id, type: 'created_node', detail: 'terminal acceptance' });
      const problem = graph.nodes.find((node) => node.kind === 'problem');
      if (problem) {
        await this.coordinatorGraph.createEdge(goalId, problem.id, result.node.id, 'decomposes');
      }
    }
    return {
      goalId,
      message: result.created
        ? 'Created Goal-level acceptance Task for the remaining contract'
        : 'Goal-level acceptance Task was created by another coordinator',
      nodeId: result.node.id,
      outcome: 'advanced',
    };
  };

  /** Claim the chosen Task node and give it a responsible task plus its acceptance contract. */
  private createResponsibleTask = async (
    graph: GoalGraphSnapshot,
    frontier: GoalGraphNode,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const claim = await this.coordinatorGraph.claimTaskNode(
      goalId,
      frontier.id,
      new Date(Date.now() - TASK_NODE_CLAIM_TTL_MS),
    );
    if (!claim) {
      const current = (await this.requireGraph(goalId)).nodes.find(
        (node) => node.id === frontier.id,
      );
      return {
        goalId,
        message: current?.taskId
          ? 'Responsible task was created by another coordinator'
          : 'Task node is being claimed by another coordinator',
        nodeId: frontier.id,
        outcome: 'waiting_external',
        taskId: current?.taskId ?? undefined,
      };
    }

    let acceptanceId: string | undefined;
    let task: TaskItem | undefined;
    try {
      const description = frontier.description ?? frontier.title;
      task = await this.taskService.createTask({
        assigneeAgentId: graph.goal.agentId ?? undefined,
        config: { checkpoint: { topic: { after: false } } },
        description: description?.slice(0, TASK_DESCRIPTION_MAX_LENGTH),
        instruction: this.buildTaskInstruction(graph, frontier.title, frontier.description),
        name: frontier.title,
        projectId: graph.goal.projectId ?? undefined,
      });
      // The terminal Goal-acceptance Task is gated on the goal's structured
      // criteria when it has them: the verify plan materializes exactly those
      // rows (deterministic checklist) instead of AI-deriving checks from the
      // requirement prose. Ordinary Tasks keep the prose-scoped contract.
      const goalCriteriaIds =
        frontier.title === GOAL_ACCEPTANCE_TASK_TITLE
          ? graph.goal.config?.acceptance?.criteriaIds
          : undefined;
      const acceptance = await this.acceptanceService.ensureForSubject('task', task.id, {
        config: {
          enabled: true,
          ...(goalCriteriaIds?.length ? { verifyCriteriaIds: goalCriteriaIds } : {}),
        },
        requirement: this.buildTaskAcceptanceRequirement(
          graph,
          frontier.title,
          frontier.description,
        ),
      });
      acceptanceId = acceptance.id;
      const bound = await this.coordinatorGraph.bindTask(goalId, frontier.id, task.id);
      if (!bound) {
        await this.acceptanceService.acceptanceModel.delete(acceptance.id);
        await this.taskModel.delete(task.id);
        return {
          goalId,
          message: 'Responsible task was created by another coordinator',
          nodeId: frontier.id,
          outcome: 'waiting_external',
        };
      }
    } catch (error) {
      if (acceptanceId) {
        await this.acceptanceService.acceptanceModel.delete(acceptanceId).catch(() => {});
      }
      if (task) {
        await this.taskModel.delete(task.id).catch((cleanupError) => {
          console.error('[GoalService.tick] failed to delete unbound task:', cleanupError);
        });
      }
      await this.coordinatorGraph.updateNodeStatus(goalId, frontier.id, 'proposed');
      throw error;
    }

    effects.push({ nodeId: frontier.id, targetId: task.id, type: 'created_task' });
    const work = await this.workModel.registerTask({
      changeType: 'created',
      taskId: task.id,
      toolIdentifier: 'goal-coordinator',
      toolName: 'createResponsibleTask',
    });
    if (work?.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        goalId,
        frontier.id,
        work.currentVersionId,
        'produced',
      );
    }
    await this.transitionStatus(graph.goal, 'running', `dispatched ${task.identifier}`);
    return {
      goalId,
      message: `Created responsible task ${task.identifier}`,
      nodeId: frontier.id,
      outcome: 'advanced',
      taskId: task.id,
    };
  };

  /**
   * Automatic recovery after a Task delivery failed verification. Spends the
   * Task's remaining attempt budget before it escalates to a person.
   */
  private recoverAfterVerification = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
    const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
    const recovery = await new TaskRecoveryCoordinator(
      this.db,
      this.userId,
      this.workspaceId,
    ).recover({ goal: graph.goal, spentCost: totalCost, task });

    if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
      await this.coordinatorGraph.updateNodeStatus(
        goalId,
        nodeId,
        'active',
        'Automatically started the next Task attempt after verification feedback',
      );
      await this.transitionStatus(graph.goal, 'running', 'automatic recovery started a run');
      // Only when this advance is the one that spawned the run. Reporting it
      // for a retry another advance owns would put a run in this trajectory
      // that it did not start, and attribute its cost here.
      if (recovery.outcome === 'started') {
        effects.push({
          detail: 'verification retry',
          nodeId,
          operationId: recovery.operationId,
          targetId: task.id,
          type: 'started_run',
        });
      }
      return {
        goalId,
        message: `Automatically retried task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    const exhaustedReason =
      recovery.outcome === 'exhausted-cost'
        ? 'Goal cost budget was exhausted'
        : recovery.outcome === 'exhausted-rounds'
          ? 'Task attempt budget was exhausted'
          : 'Automatic recovery could not start the next attempt';
    return this.openFailureDecision(graph, nodeId, task.id, exhaustedReason, effects);
  };

  /** Claim the task for dispatch and start its run. */
  private dispatchWork = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;

    // Advances arrive from independent sources — an event hook, a manual nudge,
    // the sweep — and can overlap. `runTask` decides whether a run is already
    // in flight by reading the task's topics and only then creating one, so two
    // overlapping advances would both dispatch this Task and pay for it twice.
    // Claim the task first: the transition is a single conditional UPDATE, so
    // exactly one advance can win it.
    //
    // Counting free slots is a *separate* race the per-task claim cannot cover:
    // two advances reading the same `inFlight` below the cap would each claim a
    // different task and both succeed, taking the goal past
    // `maxConcurrentTasks`. So the count and the claim happen together, under a
    // per-goal advisory lock — the planner's cap check is a fast path, this is
    // the enforcement.
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${GOAL_DISPATCH_LOCK_NAMESPACE}, hashtext(${goalId}))`,
      );

      const inFlight = await new GoalGraphModel(
        tx,
        this.userId,
        this.workspaceId,
      ).countRunningTasks(goalId);
      if (inFlight >= resolveMaxConcurrentTasks(graph.goal)) return 'at-capacity' as const;

      return new TaskModel(tx, this.userId, this.workspaceId).updateStatusIfCurrent(
        task.id,
        task.status,
        'running',
        { error: null, startedAt: new Date() },
      );
    });

    if (claimed === 'at-capacity') {
      return {
        goalId,
        message: `Concurrency limit reached before ${task.identifier} could start`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }
    if (!claimed) {
      return {
        goalId,
        message: `Task ${task.identifier} is already being started`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    try {
      const run = await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
        maxSteps: resolveTaskMaxSteps(graph.goal),
        taskId: task.id,
        trigger: 'goal',
      });
      effects.push({
        nodeId,
        operationId: run.operationId,
        targetId: task.id,
        type: 'started_run',
      });
      return {
        goalId,
        message: `Started task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: run.taskId,
      };
    } catch (error) {
      // We claimed the task, so nothing else will put it back. Release it or the
      // Task stays 'running' with no run behind it and only the lease reclaims it.
      await this.taskModel
        .updateStatusIfCurrent(task.id, 'running', task.status)
        .catch((releaseError) => {
          console.error('[GoalService.tick] failed to release claimed task:', releaseError);
        });
      throw error;
    }
  };

  private requireGraph = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return graph;
  };

  private ensureTaskWorkVersion = async (goalId: string, nodeId: string, taskId: string) => {
    const graph = await this.coordinatorGraph.getGraph(goalId);
    if (graph?.workVersions.some((link) => link.nodeId === nodeId)) return;
    const work = await this.workModel.registerTask({
      changeType: 'created',
      taskId,
      toolIdentifier: 'goal-coordinator',
      toolName: 'createResponsibleTask',
    });
    if (work?.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        goalId,
        nodeId,
        work.currentVersionId,
        'produced',
      );
    }
  };

  private recoverAbandonedTask = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult | undefined> => {
    const [runningTopic] = await this.taskTopicModel.findRunningByTaskIds([task.id]);
    const operationId = runningTopic?.operationId;
    const topicId = runningTopic?.topicId;
    const staleBefore = new Date(Date.now() - resolveOperationLeaseTimeout(graph.goal));

    if (!operationId || !topicId) {
      // No running topic covers two very different shapes. A verify-bound Task
      // that delivered keeps its task `running` with a *completed* topic until
      // the verify run settles, and that judgment — a full agent run — outlives
      // the operation lease routinely. Re-dispatching there pays for a duplicate
      // attempt the verify settle path will cancel, and the canceled retry then
      // becomes the newest topic and shadows the delivered one. Hold off while
      // the delivery is fresh; past the grace window, fall through to the
      // release below so a verify run that died silently cannot strand the
      // goal forever.
      const [lastTopic] = await this.taskTopicModel.findWithHandoff(task.id, 1);
      if (lastTopic?.status === 'completed') {
        const deliveredAt = lastTopic.completedAt ?? lastTopic.createdAt;
        if (new Date(deliveredAt).getTime() >= Date.now() - VERIFY_SETTLE_GRACE_MS) {
          return {
            goalId: graph.goal.id,
            message: `Task ${task.identifier} delivered; waiting for verification to settle`,
            nodeId,
            outcome: 'waiting_external',
            taskId: task.id,
          };
        }
      }

      // A task claimed for dispatch but with no run behind it. Normally this is
      // the sliver between the claim and `runTask` creating the topic; if the
      // worker died in there it is permanent, and every later advance would
      // report `waiting_external` forever because there is no operation to
      // reclaim. Once the claim is older than the lease, hand it back.
      if (new Date(task.updatedAt) >= staleBefore) return undefined;
      const released = await this.taskModel.updateStatusIfCurrent(task.id, 'running', 'backlog');
      if (!released) return undefined;
      return {
        goalId: graph.goal.id,
        message: `Released the abandoned dispatch claim on task ${task.identifier}`,
        nodeId,
        outcome: 'advanced',
        taskId: task.id,
      };
    }

    const latestUsage = await new AgentRuntimeCoordinator().getOperationMetadata(operationId);
    const reclaimed = await this.db.transaction(async (tx) => {
      const settled = await new AgentOperationModel(
        tx,
        this.userId,
        this.workspaceId,
      ).settleStaleRunning(operationId, staleBefore, latestUsage?.totalCost);
      if (!settled) return false;

      await new TaskTopicModel(tx, this.userId, this.workspaceId).updateStatus(
        task.id,
        topicId,
        'timeout',
      );
      await new TaskModel(tx, this.userId, this.workspaceId).updateStatus(task.id, 'paused', {
        error: LEASE_EXPIRED_ERROR,
      });
      return true;
    });
    if (!reclaimed) return undefined;

    return this.resumeAbandonedTaskRecovery(graph, nodeId, task, effects);
  };

  private resumeAbandonedTaskRecovery = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    const recovery = await new TaskRecoveryCoordinator(
      this.db,
      this.userId,
      this.workspaceId,
    ).recover({ goal: graph.goal, task });
    if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
      await this.coordinatorGraph.updateNodeStatus(
        graph.goal.id,
        nodeId,
        'active',
        'Recovered an abandoned Task operation and started the next attempt',
      );
      await this.transitionStatus(graph.goal, 'running', 'reclaimed an abandoned Task');
      if (recovery.outcome === 'started') {
        effects.push({
          detail: 'abandoned operation retry',
          nodeId,
          operationId: recovery.operationId,
          targetId: task.id,
          type: 'started_run',
        });
      }
      return {
        goalId: graph.goal.id,
        message: `Recovered abandoned task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    const reason =
      recovery.outcome === 'exhausted-cost'
        ? 'Goal cost budget was exhausted after an operation was abandoned'
        : recovery.outcome === 'exhausted-rounds'
          ? 'Task attempt budget was exhausted after an operation was abandoned'
          : 'Automatic recovery could not restart an abandoned operation';
    return this.openFailureDecision(graph, nodeId, task.id, reason, effects);
  };

  private buildTaskInstruction = (
    graph: GoalGraphSnapshot,
    title: string,
    description: string | null,
  ) =>
    [
      `Overall goal context (background only): ${graph.goal.title}`,
      graph.goal.requirement
        ? `Overall goal acceptance context (background only): ${graph.goal.requirement}`
        : undefined,
      `Current Task contract (authoritative execution scope): ${title}`,
      description,
      'Execute only the Current Task contract. Do not implement, validate, or pre-empt any sibling or downstream Task node, even when the overall goal context describes it.',
      'The complete requirements for this Task are included here. Do not inspect unrelated agent documents to recover requirements. This Task carries its own Acceptance: run it inside this Task — drive the real product surface, capture the evidence, and submit it against your own criteria while you work. Submit evidence only; an independent verifier judges whether this Task is complete.',
      'Create implementation-level subtasks when useful. Finish the operation once the Current Task deliverable and its concrete evidence are ready; Acceptance verification will decide whether this Task is complete.',
      'Make the final delivery self-contained for an independent verifier that may not have workspace access. Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands; file paths and claims that checks passed are not sufficient evidence by themselves.',
      'Return the produced artifacts, evidence, key findings, and the recommended next action. Do not mark the overall Goal complete.',
    ]
      .filter(Boolean)
      .join('\n\n');

  /**
   * Turn a goal with no tasks into an explorable structure: the LLM plans the
   * core question plus 1–5 independent directions, each carrying only its own
   * deliverable requirements. A planning failure degrades to one task seeded
   * from the raw requirement — the goal must never stall on its planner.
   */
  private planDecomposition = async (graph: GoalGraphSnapshot, effects: GoalAdvanceEffect[]) => {
    const goalId = graph.goal.id;
    const problem = graph.nodes.find((node) => node.kind === 'problem');
    const requirement = graph.goal.requirement ?? problem?.description ?? graph.goal.title;

    // Two advances can reach this branch together — the queued kickoff and the
    // client's fire-and-forget fallback both see zero Tasks. The conditional
    // `planning → running` write is the claim: the loser stops before even
    // calling the planner, so nothing double-plans and nothing double-pays.
    // `waiting_external` ends its advance loop — the winner carries the goal.
    if (graph.goal.status === 'planning') {
      const claimed = await this.goalModel.claimPlanning(goalId);
      if (!claimed) {
        return {
          goalId,
          message: 'Another advance is already planning this goal',
          outcome: 'waiting_external' as const,
        };
      }
      await this.coordinatorGraph
        .recordGoalStatus(goalId, 'planning', 'running', 'decomposition claimed')
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
    }

    const generator = new GoalCriteriaGeneratorService(this.db, this.userId, this.workspaceId);
    const plan = await generator.decompose({ requirement }).catch(() => undefined);

    // Rare shape: a goal already past `planning` whose Tasks were all removed.
    // There is no status edge to claim on that path, so shrink the duplicate
    // window to the instant before the inserts with a re-read instead.
    if (graph.goal.status !== 'planning') {
      const fresh = await this.graphModel.getGraph(goalId);
      if (fresh?.nodes.some((node) => node.kind === 'task')) {
        return {
          goalId,
          message: 'Decomposition already planned by a concurrent advance',
          outcome: 'advanced' as const,
        };
      }
    }

    const draftTasks: GoalDecompositionDraft['tasks'] = plan?.tasks ?? [
      { instruction: problem?.description ?? requirement, title: graph.goal.title },
    ];

    if (plan && problem) {
      // The node's description becomes the planner's own words for the core
      // question — not the acceptance boilerplate the goal row keeps.
      await this.coordinatorGraph.updateNodeDescription(goalId, problem.id, plan.problemStatement);
    }

    const createdIds: (string | undefined)[] = [];
    for (const draft of draftTasks) {
      const node = await this.coordinatorGraph.createNode(goalId, {
        description: draft.instruction,
        kind: 'task',
        title: draft.title,
      });
      createdIds.push(node?.id);
      if (!node) continue;
      if (problem)
        await this.coordinatorGraph.createEdge(goalId, problem.id, node.id, 'decomposes');
      effects.push({ nodeId: node.id, type: 'created_node', detail: draft.title });
    }

    // The planner's `dependsOn` indices become `depends_on` edges, drawn
    // dependent → prerequisite the way `decideNextMove` reads a blocker. Only
    // earlier indices are honoured, so a hallucinated forward or self reference
    // can never form a cycle that deadlocks the frontier.
    for (const [index, draft] of draftTasks.entries()) {
      const nodeId = createdIds[index];
      if (!nodeId) continue;
      for (const dep of new Set(draft.dependsOn ?? [])) {
        const prerequisiteId = dep < index ? createdIds[dep] : undefined;
        if (!prerequisiteId) continue;
        await this.coordinatorGraph.createEdge(goalId, nodeId, prerequisiteId, 'depends_on');
      }
    }

    return {
      goalId,
      message: plan
        ? `Planned ${draftTasks.length} exploration direction${draftTasks.length > 1 ? 's' : ''}`
        : 'Planner unavailable; seeded a single task from the requirement',
      outcome: 'advanced' as const,
    };
  };

  private buildTaskAcceptanceRequirement = (
    graph: GoalGraphSnapshot,
    title: string,
    description: string | null,
  ) => {
    if (title === GOAL_ACCEPTANCE_TASK_TITLE) {
      return [
        `Terminal Goal acceptance requirement (authoritative): ${graph.goal.requirement ?? graph.goal.title}`,
        description ? `Required delivery: ${description}` : undefined,
        'PASS only when concrete evidence proves that every clause of the terminal Goal acceptance requirement is satisfied.',
        'An accurate gap analysis, a report that the Goal is not accepted, a suggested next action, or partial progress is NOT a passing delivery. Reject it so automatic recovery can continue or open a Gate.',
        'If any required count, field, evidence quality, or other explicit threshold is missing, the verdict MUST be failed even when the builder correctly identified and documented the gap.',
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    // The full goal requirement (with its numbered acceptance list) is NOT
    // injected here: it belongs to the terminal acceptance task above, and
    // pasting it into every Task made each task's acceptance read as the whole
    // contract. A Task is judged on its own outcome only.
    return [
      `Verify only this Task: ${title}.`,
      description ? `Required Task outcome: ${description}` : undefined,
      `This Task is one direction of the Goal "${graph.goal.title}"; the full Goal contract is verified separately at the end.`,
      'Pass only when the current Task deliverable is complete and supported by concrete evidence. Ignore sibling and downstream Task deliverables; they are verified by their own acceptance runs.',
    ]
      .filter(Boolean)
      .join('\n\n');
  };

  private consumeCompletedTask = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    const existingFinding = graph.edges.some(
      (edge) => edge.sourceNodeId === nodeId && edge.kind === 'produces',
    );
    // The newest row by seq can be a retry that was canceled when verification
    // accepted an earlier delivery — the settle path cancels the in-flight
    // attempt it superseded. The finding must be synthesized from the run that
    // actually delivered, so prefer the newest completed topic (with a handoff
    // when one exists) over whatever happens to be last.
    const recent = await this.taskTopicModel.findWithHandoff(taskId, 10);
    const latest =
      recent.find((topic) => topic.status === 'completed' && topic.handoff) ??
      recent.find((topic) => topic.status === 'completed') ??
      recent[0];
    const completedWork = await this.workModel.registerTask({
      changeType: 'updated',
      rootOperationId: latest?.operationId,
      taskId,
      toolIdentifier: 'goal-coordinator',
      toolName: 'synthesizeTaskOutcome',
      topicId: latest?.topicId,
    });
    effects.push({
      nodeId,
      operationId: latest?.operationId ?? undefined,
      targetId: taskId,
      type: 'node_status',
      detail: 'resolved',
    });
    if (completedWork?.currentVersionId) {
      await this.coordinatorGraph.attachWorkVersion(
        graph.goal.id,
        nodeId,
        completedWork.currentVersionId,
        'produced',
      );
    }
    if (!existingFinding) {
      const handoff = latest?.handoff as TaskTopicHandoff | null;
      const finding = await this.coordinatorGraph.createNode(graph.goal.id, {
        confidence: 1,
        description: handoff?.content ?? handoff?.summary ?? undefined,
        kind: 'finding',
        status: 'resolved',
        title:
          handoff?.title ??
          handoff?.summary ??
          `Completed: ${graph.nodes.find((node) => node.id === nodeId)?.title}`,
      });
      if (finding) {
        effects.push({ detail: 'finding', nodeId, targetId: finding.id, type: 'created_node' });
        await this.coordinatorGraph.createEdge(graph.goal.id, nodeId, finding.id, 'produces');
      }
    }
    await this.coordinatorGraph.updateNodeStatus(
      graph.goal.id,
      nodeId,
      'resolved',
      'Responsible task completed',
    );
    return {
      goalId: graph.goal.id,
      message: 'Task outcome was synthesized into a finding',
      nodeId,
      outcome: 'advanced',
      taskId,
    };
  };

  private openFailureDecision = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
    reason: string,
    effects: GoalAdvanceEffect[] = [],
  ): Promise<GoalTickResult> => {
    const existingDecisionNode = graph.edges
      .filter((edge) => edge.sourceNodeId === nodeId && edge.kind === 'leads_to')
      .map((edge) => graph.nodes.find((node) => node.id === edge.targetNodeId))
      .find((node) => node?.kind === 'decision' && node.status !== 'resolved');
    if (!existingDecisionNode) {
      const node = await this.coordinatorGraph.createNode(graph.goal.id, {
        description: reason,
        kind: 'decision',
        status: 'waiting',
        title: 'Choose how to recover failed task',
      });
      if (node) {
        effects.push({ detail: reason, nodeId, targetId: node.id, type: 'opened_decision' });
        await this.coordinatorGraph.createEdge(graph.goal.id, nodeId, node.id, 'leads_to');
        const terminalAcceptance =
          graph.nodes.find((candidate) => candidate.id === nodeId)?.title ===
          GOAL_ACCEPTANCE_TASK_TITLE;
        await this.coordinatorGraph.createDecision(graph.goal.id, node.id, {
          authority: 'user',
          options: terminalAcceptance
            ? [
                { id: 'retry', label: 'Retry goal acceptance' },
                { id: 'fail', label: 'Fail goal' },
              ]
            : [
                { id: 'retry', label: 'Retry task' },
                { id: 'retire', label: 'Retire task' },
              ],
          question: terminalAcceptance
            ? `${reason}. Retry Goal acceptance or fail this Goal?`
            : `${reason}. Retry or retire this task node?`,
          recommendedOptionId: 'retry',
          requestedUserId: this.userId,
        });
      }
    }
    await this.coordinatorGraph.updateNodeStatus(graph.goal.id, nodeId, 'waiting', reason);
    await this.transitionStatus(graph.goal, 'review', reason);
    return {
      goalId: graph.goal.id,
      message: 'Task failed; a human decision gate was opened',
      nodeId,
      outcome: 'waiting_human',
      taskId,
    };
  };
}
