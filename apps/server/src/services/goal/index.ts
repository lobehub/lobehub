import type {
  GoalEdgeKind,
  GoalGraphSnapshot,
  GoalNodeKind,
  GoalNodeStatus,
  GoalRecoveryPolicy,
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
import { resolveOperationLeaseTimeout, resolveWorkMaxSteps } from './recoveryPolicy';
import { WorkRecoveryCoordinator } from './workRecoveryCoordinator';

const WORK_NODE_CLAIM_TTL_MS = 5 * 60 * 1000;
const TASK_DESCRIPTION_MAX_LENGTH = 255;
const GOAL_ACCEPTANCE_WORK_TITLE = 'Complete full Goal acceptance';

export interface CreateGoalGraphInput {
  agentId?: string;
  config?: { recovery?: GoalRecoveryPolicy };
  maxRounds?: number;
  maxTotalCost?: number;
  projectId?: string;
  requirement?: string;
  title: string;
  work?: string[];
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
  private readonly graphModel: GoalGraphModel;
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
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskService = new TaskService(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
    this.workModel = new WorkModel(db, userId, workspaceId);
  }

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
    try {
      const problem = await this.graphModel.createNode(goal.id, {
        description: input.requirement,
        kind: 'problem',
        status: 'active',
        title: input.title,
      });
      if (!problem) throw new Error('Failed to seed goal problem');

      for (const title of input.work ?? []) {
        const work = await this.graphModel.createNode(goal.id, { kind: 'work', title });
        if (!work) throw new Error('Failed to seed goal work');
        await this.graphModel.createEdge(goal.id, problem.id, work.id, 'decomposes');
      }
    } catch (error) {
      await this.goalModel.delete(goal.id).catch(() => {});
      throw error;
    }
    return (await this.graphModel.getGraph(goal.id))!;
  };

  graph = async (goalId: string) => this.requireGraph(goalId);

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

  pause = async (goalId: string) => {
    const goal = await this.goalModel.updateStatus(goalId, 'paused');
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
  };

  setBudget = async (
    goalId: string,
    budget: { maxRounds?: number | null; maxTotalCost?: number | null },
  ) => {
    const goal = await this.goalModel.update(goalId, budget);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return goal;
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
    if (source?.kind === 'work') {
      if (optionId === 'retry' && source.taskId) {
        await this.taskModel.updateStatus(source.taskId, 'backlog', { error: null });
        await this.graphModel.updateNodeStatus(goalId, source.id, 'active', resolution);
      } else if (
        optionId === 'retire' ||
        (optionId === 'fail' && source.title === GOAL_ACCEPTANCE_WORK_TITLE)
      ) {
        await this.graphModel.updateNodeStatus(goalId, source.id, 'retired', resolution);
      }
    }
    const terminalAcceptanceFailed =
      source?.title === GOAL_ACCEPTANCE_WORK_TITLE &&
      (optionId === 'retire' || optionId === 'fail');
    await this.goalModel.updateStatus(goalId, terminalAcceptanceFailed ? 'failed' : 'running');
    return resolved;
  };

  tick = async (goalId: string): Promise<GoalTickResult> => {
    const graph = await this.requireGraph(goalId);
    if (graph.goal.status === 'paused') {
      return { goalId, message: 'Goal is paused', outcome: 'no_progress' };
    }
    if (graph.goal.status === 'achieved') {
      return { goalId, message: 'Goal is already achieved', outcome: 'achieved' };
    }
    if (graph.goal.status === 'failed' || graph.goal.status === 'canceled') {
      return { goalId, message: `Goal is ${graph.goal.status}`, outcome: 'failed' };
    }

    const pendingDecision = graph.decisions.find((decision) => decision.status === 'pending');
    if (pendingDecision) {
      await this.goalModel.updateStatus(goalId, 'review');
      return {
        goalId,
        message: pendingDecision.question,
        nodeId: pendingDecision.nodeId,
        outcome: 'waiting_human',
      };
    }

    const resolvedNodeIds = new Set(
      graph.nodes.filter((node) => node.status === 'resolved').map((node) => node.id),
    );
    const frontier = graph.nodes
      .filter((node) => {
        if (node.kind !== 'work' || ['resolved', 'rejected', 'retired'].includes(node.status)) {
          return false;
        }

        const dependencies = graph.edges.filter(
          (edge) => edge.kind === 'depends_on' && edge.sourceNodeId === node.id,
        );
        return dependencies.every((edge) => resolvedNodeIds.has(edge.targetNodeId));
      })
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!frontier) {
      const workNodes = graph.nodes.filter((node) => node.kind === 'work');
      const allWorkTerminal =
        workNodes.length > 0 &&
        workNodes.every((node) => ['resolved', 'rejected', 'retired'].includes(node.status));
      if (allWorkTerminal) {
        const goalAcceptanceWork = workNodes.find(
          (node) => node.title === GOAL_ACCEPTANCE_WORK_TITLE,
        );
        if (graph.goal.requirement && !goalAcceptanceWork) {
          const result = await this.graphModel.createNodeOnce(goalId, {
            description: [
              `Complete and prove the overall Goal acceptance requirement: ${graph.goal.requirement}`,
              'Inspect and reuse existing Goal findings, artifacts, metrics, and command results as the primary evidence. Do not repeat expensive or destructive work when the existing evidence is sufficient and still auditable.',
              'Explicitly close every remaining acceptance gap instead of treating completed upstream Work as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.',
              'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.',
            ].join('\n\n'),
            kind: 'work',
            priority: -1,
            title: GOAL_ACCEPTANCE_WORK_TITLE,
          });
          if (!result) {
            return {
              goalId,
              message: 'Could not create the Goal-level acceptance Work',
              outcome: 'no_progress',
            };
          }
          if (result.created) {
            const problem = graph.nodes.find((node) => node.kind === 'problem');
            if (problem) {
              await this.graphModel.createEdge(goalId, problem.id, result.node.id, 'decomposes');
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
        }
        if (graph.goal.requirement && goalAcceptanceWork?.status !== 'resolved') {
          return {
            goalId,
            message: 'Goal-level acceptance did not pass',
            nodeId: goalAcceptanceWork?.id,
            outcome: 'no_progress',
          };
        }
        await this.goalModel.updateStatus(goalId, 'achieved');
        return { goalId, message: 'Goal-level acceptance passed', outcome: 'achieved' };
      }
      return {
        goalId,
        message:
          workNodes.length === 0
            ? 'No work frontier exists; add a work node'
            : 'No work node is ready; resolve its dependencies first',
        outcome: 'no_progress',
      };
    }

    if (!frontier.taskId) {
      const claim = await this.graphModel.claimWorkNode(
        goalId,
        frontier.id,
        new Date(Date.now() - WORK_NODE_CLAIM_TTL_MS),
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
          instruction: this.buildWorkInstruction(graph, frontier.title, frontier.description),
          name: frontier.title,
          projectId: graph.goal.projectId ?? undefined,
        });
        const acceptance = await this.acceptanceService.ensureForSubject('task', task.id, {
          config: { enabled: true },
          requirement: this.buildWorkAcceptanceRequirement(
            graph,
            frontier.title,
            frontier.description,
          ),
        });
        acceptanceId = acceptance.id;
        const bound = await this.graphModel.bindTask(goalId, frontier.id, task.id);
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
        await this.graphModel.updateNodeStatus(goalId, frontier.id, 'proposed');
        throw error;
      }
      const work = await this.workModel.registerTask({
        changeType: 'created',
        taskId: task.id,
        toolIdentifier: 'goal-coordinator',
        toolName: 'createResponsibleTask',
      });
      if (work?.currentVersionId) {
        await this.graphModel.attachWorkVersion(
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
    }

    const task = await this.taskModel.findById(frontier.taskId);
    if (!task) {
      await this.graphModel.updateNodeStatus(
        goalId,
        frontier.id,
        'waiting',
        'Responsible task is missing',
      );
      return {
        goalId,
        message: 'Responsible task is missing',
        nodeId: frontier.id,
        outcome: 'failed',
      };
    }
    await this.ensureTaskWorkVersion(graph.goal.id, frontier.id, task.id);

    if (task.status === 'completed') return this.consumeCompletedWork(graph, frontier.id, task.id);
    if (
      task.status === 'failed' ||
      task.status === 'canceled' ||
      (task.status === 'paused' && task.error)
    ) {
      if (task.status === 'paused' && task.error === 'Goal Work operation lease expired.') {
        return this.resumeAbandonedWorkRecovery(graph, frontier.id, task);
      }
      if (task.status === 'paused' && task.error === 'Delivery did not pass verification.') {
        const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
        const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
        const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
        const recovery = await new WorkRecoveryCoordinator(
          this.db,
          this.userId,
          this.workspaceId,
        ).recover({ goal: graph.goal, spentCost: totalCost, task, taskCarried: false });
        if (recovery === 'continued') {
          await this.graphModel.updateNodeStatus(
            goalId,
            frontier.id,
            'active',
            'Automatically started the next Work attempt after verification feedback',
          );
          await this.goalModel.updateStatus(goalId, 'running');
          return {
            goalId,
            message: `Automatically retried task ${task.identifier}`,
            nodeId: frontier.id,
            outcome: 'waiting_external',
            taskId: task.id,
          };
        }
        const exhaustedReason =
          recovery === 'exhausted-cost'
            ? 'Goal cost budget was exhausted'
            : recovery === 'exhausted-rounds'
              ? 'Work attempt budget was exhausted'
              : 'Automatic recovery could not start the next attempt';
        return this.openFailureDecision(graph, frontier.id, task.id, exhaustedReason);
      }
      return this.openFailureDecision(
        graph,
        frontier.id,
        task.id,
        task.error ?? `Task ${task.status}`,
      );
    }
    if (task.status === 'paused') {
      return {
        goalId,
        message: `Task ${task.identifier} is paused`,
        nodeId: frontier.id,
        outcome: 'waiting_human',
        taskId: task.id,
      };
    }
    if (task.status === 'running' || task.status === 'scheduled') {
      if (task.status === 'running') {
        const recovered = await this.recoverAbandonedWork(graph, frontier.id, task);
        if (recovered) return recovered;
      }
      return {
        goalId,
        message: `Task ${task.identifier} is ${task.status}`,
        nodeId: frontier.id,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const runs = await this.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
    const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
    const roundLimitReached = graph.goal.maxRounds !== null && runs.length >= graph.goal.maxRounds;
    const costLimitReached =
      graph.goal.maxTotalCost !== null && totalCost >= Number(graph.goal.maxTotalCost);
    if (roundLimitReached || costLimitReached) {
      await this.goalModel.updateStatus(goalId, 'paused');
      return {
        goalId,
        message: roundLimitReached
          ? `Round budget reached (${runs.length}/${graph.goal.maxRounds})`
          : `Cost budget reached ($${totalCost.toFixed(4)}/$${graph.goal.maxTotalCost})`,
        nodeId: frontier.id,
        outcome: 'no_progress',
        taskId: task.id,
      };
    }

    const run = await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
      maxSteps: resolveWorkMaxSteps(graph.goal),
      taskId: task.id,
      trigger: 'goal',
    });
    return {
      goalId,
      message: `Started task ${task.identifier}`,
      nodeId: frontier.id,
      outcome: 'waiting_external',
      taskId: run.taskId,
    };
  };

  private requireGraph = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (!graph) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    return graph;
  };

  private ensureTaskWorkVersion = async (goalId: string, nodeId: string, taskId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (graph?.workVersions.some((link) => link.nodeId === nodeId)) return;
    const work = await this.workModel.registerTask({
      changeType: 'created',
      taskId,
      toolIdentifier: 'goal-coordinator',
      toolName: 'createResponsibleTask',
    });
    if (work?.currentVersionId) {
      await this.graphModel.attachWorkVersion(goalId, nodeId, work.currentVersionId, 'produced');
    }
  };

  private recoverAbandonedWork = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
  ): Promise<GoalTickResult | undefined> => {
    const [runningTopic] = await this.taskTopicModel.findRunningByTaskIds([task.id]);
    const operationId = runningTopic?.operationId;
    const topicId = runningTopic?.topicId;
    if (!operationId || !topicId) return undefined;

    const staleBefore = new Date(Date.now() - resolveOperationLeaseTimeout(graph.goal));
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

    return this.resumeAbandonedWorkRecovery(graph, nodeId, task);
  };

  private resumeAbandonedWorkRecovery = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
  ): Promise<GoalTickResult> => {
    const recovery = await new WorkRecoveryCoordinator(
      this.db,
      this.userId,
      this.workspaceId,
    ).recover({ goal: graph.goal, task, taskCarried: false });
    if (recovery === 'continued') {
      await this.graphModel.updateNodeStatus(
        graph.goal.id,
        nodeId,
        'active',
        'Recovered an abandoned Work operation and started the next attempt',
      );
      await this.goalModel.updateStatus(graph.goal.id, 'running');
      return {
        goalId: graph.goal.id,
        message: `Recovered abandoned task ${task.identifier}`,
        nodeId,
        outcome: 'waiting_external',
        taskId: task.id,
      };
    }

    const reason =
      recovery === 'exhausted-cost'
        ? 'Goal cost budget was exhausted after an operation was abandoned'
        : recovery === 'exhausted-rounds'
          ? 'Work attempt budget was exhausted after an operation was abandoned'
          : 'Automatic recovery could not restart an abandoned operation';
    return this.openFailureDecision(graph, nodeId, task.id, reason);
  };

  private buildWorkInstruction = (
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

  private buildWorkAcceptanceRequirement = (
    graph: GoalGraphSnapshot,
    title: string,
    description: string | null,
  ) => {
    if (title === GOAL_ACCEPTANCE_WORK_TITLE) {
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

  private consumeCompletedWork = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    taskId: string,
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
    if (completedWork?.currentVersionId) {
      await this.graphModel.attachWorkVersion(
        graph.goal.id,
        nodeId,
        completedWork.currentVersionId,
        'produced',
      );
    }
    if (!existingFinding) {
      const handoff = latest?.handoff as TaskTopicHandoff | null;
      const finding = await this.graphModel.createNode(graph.goal.id, {
        confidence: 1,
        description: handoff?.content ?? handoff?.summary ?? undefined,
        kind: 'finding',
        status: 'resolved',
        title:
          handoff?.title ??
          handoff?.summary ??
          `Completed: ${graph.nodes.find((node) => node.id === nodeId)?.title}`,
      });
      if (finding) await this.graphModel.createEdge(graph.goal.id, nodeId, finding.id, 'produces');
    }
    await this.graphModel.updateNodeStatus(
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
  ): Promise<GoalTickResult> => {
    const existingDecisionNode = graph.edges
      .filter((edge) => edge.sourceNodeId === nodeId && edge.kind === 'leads_to')
      .map((edge) => graph.nodes.find((node) => node.id === edge.targetNodeId))
      .find((node) => node?.kind === 'decision' && node.status !== 'resolved');
    if (!existingDecisionNode) {
      const node = await this.graphModel.createNode(graph.goal.id, {
        description: reason,
        kind: 'decision',
        status: 'waiting',
        title: 'Choose how to recover failed work',
      });
      if (node) {
        await this.graphModel.createEdge(graph.goal.id, nodeId, node.id, 'leads_to');
        const terminalAcceptance =
          graph.nodes.find((candidate) => candidate.id === nodeId)?.title ===
          GOAL_ACCEPTANCE_WORK_TITLE;
        await this.graphModel.createDecision(graph.goal.id, node.id, {
          authority: 'user',
          options: terminalAcceptance
            ? [
                { id: 'retry', label: 'Retry goal acceptance' },
                { id: 'fail', label: 'Fail goal' },
              ]
            : [
                { id: 'retry', label: 'Retry work' },
                { id: 'retire', label: 'Retire work' },
              ],
          question: terminalAcceptance
            ? `${reason}. Retry Goal acceptance or fail this Goal?`
            : `${reason}. Retry or retire this work node?`,
          recommendedOptionId: 'retry',
          requestedUserId: this.userId,
        });
      }
    }
    await this.graphModel.updateNodeStatus(graph.goal.id, nodeId, 'waiting', reason);
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
