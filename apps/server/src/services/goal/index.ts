import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
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
import {
  decideNextMove,
  GOAL_ACCEPTANCE_TASK_TITLE,
  type GoalMove,
  needsBudget,
  selectFrontier,
} from './decideNextMove';
import { resolveOperationLeaseTimeout, resolveTaskMaxSteps } from './recoveryPolicy';
import { TaskRecoveryCoordinator } from './taskRecoveryCoordinator';
import {
  type GoalTickOptions,
  toBudgetState,
  toFrontierTaskState,
  toTraceGraphState,
} from './traceObservation';

const TASK_NODE_CLAIM_TTL_MS = 5 * 60 * 1000;
const TASK_DESCRIPTION_MAX_LENGTH = 255;

export interface CreateGoalWorkInput {
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
  maxRounds?: number;
  maxTotalCost?: number;
  projectId?: string;
  requirement?: string;
  title: string;
  /** Seed Work nodes, in dependency-free order. A plain string is title-only. */
  work?: Array<CreateGoalWorkInput | string>;
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
   * Graph writes the coordinator makes on its own — claiming Work, binding its
   * task, synthesizing a finding, opening a gate. Attributed to the coordinator
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
    const goal = await this.goalModel.create({
      agentId: input.agentId,
      config: input.config,
      maxRounds: input.maxRounds,
      maxTotalCost: input.maxTotalCost,
      projectId: input.projectId,
      requirement: input.requirement,
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
        description: input.requirement,
        kind: 'problem',
        status: 'active',
        title: input.title,
      });
      if (!problem) throw new Error('Failed to seed goal problem');

      for (const seed of input.work ?? []) {
        const { description, title } = typeof seed === 'string' ? { title: seed } : seed;
        const work = await authorGraph.createNode(goal.id, {
          createdByAgentId: input.createdByAgentId,
          description,
          kind: 'task',
          title,
        });
        if (!work) throw new Error('Failed to seed goal work');
        await authorGraph.createEdge(goal.id, problem.id, work.id, 'decomposes');
      }
    } catch (error) {
      await this.goalModel.delete(goal.id).catch(() => {});
      throw error;
    }
    return (await this.graphModel.getGraph(goal.id))!;
  };

  graph = async (goalId: string) => this.requireGraph(goalId);

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
   * Deleting only the goal row cascades the graph away but leaves each Work
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

  pause = async (goalId: string) => {
    const goal = await this.goalModel.updateStatus(goalId, 'paused');
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  /**
   * What the goal has spent against what it is allowed to spend.
   *
   * Rounds are counted across every Work Task in the graph, not per Work — the
   * budget is the goal's, so `setBudget` has to read it exactly the way the
   * coordinator does or raising a budget would not reliably unstick a goal.
   */
  private evaluateBudget = async (goal: GoalItem, graph: GoalGraphSnapshot) => {
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
    const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
    return {
      costLimitReached: goal.maxTotalCost !== null && totalCost >= Number(goal.maxTotalCost),
      roundLimitReached: goal.maxRounds !== null && runs.length >= goal.maxRounds,
      runs,
      totalCost,
    };
  };

  setBudget = async (
    goalId: string,
    budget: { maxRounds?: number | null; maxTotalCost?: number | null },
  ) => {
    const before = await this.requireGraph(goalId);
    const wasBinding = await this.evaluateBudget(before.goal, before);

    const goal = await this.goalModel.update(goalId, budget);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

    // Raising a budget is how a user un-sticks a goal the coordinator parked on
    // one, and `tick` refuses to move a paused goal — so without this the
    // queued advance would return straight away and the user would have to find
    // Resume as a second gesture. Only a goal the budget actually stopped is
    // reopened: if the old budget was not binding, this pause was somebody's
    // deliberate one and is left alone.
    const stoppedByBudget = wasBinding.costLimitReached || wasBinding.roundLimitReached;
    if (goal.status !== 'paused' || !stoppedByBudget) return goal;

    const nowBinding = await this.evaluateBudget(goal, before);
    if (nowBinding.costLimitReached || nowBinding.roundLimitReached) return goal;

    return (await this.resume(goalId)) ?? goal;
  };

  resume = async (goalId: string) => {
    const graph = await this.requireGraph(goalId);
    const status = graph.decisions.some((decision) => decision.status === 'pending')
      ? 'review'
      : 'running';
    return this.goalModel.updateStatus(goalId, status);
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
    await this.goalModel.updateStatus(goalId, terminalAcceptanceFailed ? 'failed' : 'running');
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
    const chosen = frontier.chosen;

    const frontierTask = chosen?.taskId
      ? ((await this.taskModel.findById(chosen.taskId)) ?? null)
      : undefined;
    // Only the branch that could start a run reads the budget, so a goal that is
    // merely waiting on running Work does not pay for the query on every sweep.
    const budget = needsBudget(frontierTask)
      ? toBudgetState(graph.goal, await this.evaluateBudget(graph.goal, graph))
      : undefined;

    const move = decideNextMove({ budget, frontier, frontierTask, graph });
    const effects: GoalAdvanceEffect[] = [];

    const observe = (result: GoalTickResult): GoalTickResult => {
      options?.onDecision?.({
        at,
        branch: move.branch,
        budget,
        candidates: move.candidates,
        chosenNodeId: move.chosenNodeId,
        effects,
        frontierTask: frontierTask ? toFrontierTaskState(frontierTask) : undefined,
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
        await this.goalModel.updateStatus(goalId, 'review');
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

      case 'no_frontier': {
        // Say so on the row instead of leaving a goal that reads as `running`
        // while it cannot run — and, just as importantly, take it out of the
        // sweep's window. A `running` goal that always reports `no_progress` is
        // picked by every scan forever, and enough of them starve every other
        // stalled goal out of the newest-first limit.
        await this.goalModel.updateStatus(goalId, 'paused');
        effects.push({ type: 'goal_status', detail: 'paused' });
        return observe({ goalId, message: move.message, outcome: move.outcome });
      }

      case 'create_task': {
        return observe(await this.createResponsibleTask(graph, chosen!, effects));
      }

      case 'missing_task': {
        await this.coordinatorGraph.updateNodeStatus(
          goalId,
          chosen!.id,
          'waiting',
          'Responsible task is missing',
        );
        effects.push({ nodeId: chosen!.id, type: 'node_status', detail: 'waiting' });
        return observe({
          goalId,
          message: move.message,
          nodeId: chosen!.id,
          outcome: move.outcome,
        });
      }

      default: {
        // Everything from here on has a live responsible task.
        const task = frontierTask!;
        await this.ensureTaskWorkVersion(graph.goal.id, chosen!.id, task.id);

        switch (move.branch) {
          case 'consume_completed': {
            return observe(await this.consumeCompletedTask(graph, chosen!.id, task.id, effects));
          }

          case 'recover_lease': {
            return observe(
              await this.resumeAbandonedTaskRecovery(graph, chosen!.id, task, effects),
            );
          }

          case 'recover_verification': {
            return observe(await this.recoverAfterVerification(graph, chosen!.id, task, effects));
          }

          case 'failure_decision': {
            return observe(
              await this.openFailureDecision(graph, chosen!.id, task.id, move.message, effects),
            );
          }

          case 'task_paused': {
            return observe({
              goalId,
              message: move.message,
              nodeId: chosen!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          case 'task_running': {
            if (task.status === 'running') {
              const recovered = await this.recoverAbandonedTask(graph, chosen!.id, task, effects);
              if (recovered) return observe(recovered);
            }
            return observe({
              goalId,
              message: move.message,
              nodeId: chosen!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          case 'budget_exhausted': {
            await this.goalModel.updateStatus(goalId, 'paused');
            effects.push({ type: 'goal_status', detail: 'paused' });
            return observe({
              goalId,
              message: move.message,
              nodeId: chosen!.id,
              outcome: move.outcome,
              taskId: task.id,
            });
          }

          default: {
            return observe(await this.dispatchWork(graph, chosen!.id, task, effects));
          }
        }
      }
    }
  };

  /**
   * Create the Goal-level acceptance Work, or read the verdict it already
   * reached. Only runs once every other Work is terminal.
   */
  private settleTerminalAcceptance = async (
    graph: GoalGraphSnapshot,
    move: GoalMove,
    effects: GoalAdvanceEffect[],
  ): Promise<GoalTickResult> => {
    const goalId = graph.goal.id;

    if (move.outcome === 'achieved') {
      await this.goalModel.updateStatus(goalId, 'achieved');
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
        'Explicitly close every remaining acceptance gap instead of treating completed upstream Work as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.',
        'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.',
      ].join('\n\n'),
      kind: 'task',
      priority: -1,
      title: GOAL_ACCEPTANCE_TASK_TITLE,
    });
    if (!result) {
      return {
        goalId,
        message: 'Could not create the Goal-level acceptance Work',
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
        ? 'Created Goal-level acceptance Work for the remaining contract'
        : 'Goal-level acceptance Work was created by another coordinator',
      nodeId: result.node.id,
      outcome: 'advanced',
    };
  };

  /** Claim the chosen Work and give it a responsible task plus its acceptance contract. */
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
          : 'Work node is being claimed by another coordinator',
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
      const acceptance = await this.acceptanceService.ensureForSubject('task', task.id, {
        config: { enabled: true },
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
    await this.goalModel.updateStatus(goalId, 'running');
    return {
      goalId,
      message: `Created responsible task ${task.identifier}`,
      nodeId: frontier.id,
      outcome: 'advanced',
      taskId: task.id,
    };
  };

  /**
   * Automatic recovery after a Work delivery failed verification. Spends the
   * Work's remaining attempt budget before it escalates to a person.
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
        'Automatically started the next Work attempt after verification feedback',
      );
      await this.goalModel.updateStatus(goalId, 'running');
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
          ? 'Work attempt budget was exhausted'
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
    // overlapping advances would both dispatch this Work and pay for it twice.
    // Claim the task first: the transition is a single conditional UPDATE, so
    // exactly one advance can win it.
    const claimed = await this.taskModel.updateStatusIfCurrent(task.id, task.status, 'running', {
      error: null,
      startedAt: new Date(),
    });
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
      // Work stays 'running' with no run behind it and only the lease reclaims it.
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
        error: 'Goal Work operation lease expired.',
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
        'Recovered an abandoned Work operation and started the next attempt',
      );
      await this.goalModel.updateStatus(graph.goal.id, 'running');
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
          ? 'Work attempt budget was exhausted after an operation was abandoned'
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
      `Current Work contract (authoritative execution scope): ${title}`,
      description,
      'Execute only the Current Work contract. Do not implement, validate, or pre-empt any sibling or downstream Work node, even when the overall goal context describes it.',
      'The complete requirements for this Work are included here. Do not inspect unrelated agent documents to recover requirements. Do not invoke Acceptance skills or Acceptance CLI commands during the main Work; a dedicated post-run phase will ask you to submit your evidence before an independent verifier judges it.',
      'Create implementation-level subtasks when useful. Finish the operation once the Current Work deliverable and its concrete evidence are ready; Acceptance verification will decide whether this Task is complete.',
      'Make the final delivery self-contained for an independent verifier that may not have workspace access. Include the relevant artifact contents or exact excerpts and the raw outputs of decisive verification commands; file paths and claims that checks passed are not sufficient evidence by themselves.',
      'Return the produced artifacts, evidence, key findings, and the recommended next action. Do not mark the overall Goal complete.',
    ]
      .filter(Boolean)
      .join('\n\n');

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

    return [
      `Verify only this Work: ${title}.`,
      description ? `Required Work outcome: ${description}` : undefined,
      graph.goal.requirement
        ? `Use this overall Goal requirement only to interpret requirements relevant to the current Work: ${graph.goal.requirement}`
        : undefined,
      'Pass only when the current Work deliverable is complete and supported by concrete evidence. Ignore sibling and downstream Work deliverables; they are verified by their own Tasks.',
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
    const [latest] = await this.taskTopicModel.findWithHandoff(taskId, 1);
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
    await this.goalModel.updateStatus(graph.goal.id, 'review');
    return {
      goalId: graph.goal.id,
      message: 'Task failed; a human decision gate was opened',
      nodeId,
      outcome: 'waiting_human',
      taskId,
    };
  };
}
