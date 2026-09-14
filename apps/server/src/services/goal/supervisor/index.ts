import { GoalSupervisorIdentifier } from '@lobechat/builtin-tool-goal/supervisor';
import { buildGoalSupervisorPrompt, GOAL_SUPERVISOR_INSTRUCTIONS } from '@lobechat/prompts';
import type {
  GoalGraphSnapshot,
  GoalSupervisionIncident,
  GoalSupervisionState,
  GoalTickResult,
  TaskItem,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import { resolveGoalModelConfig } from '../modelConfig';
import { scheduleGoalAdvance } from '../scheduler';
import { claimGoalTask } from '../taskClaim';
import {
  RECOVERABLE_TASK_STATUSES,
  recoveryEligibility,
  statusAuthoredByActor,
  supervisionLimit,
  SUPERVISOR_DIAGNOSIS_TIMEOUT_MS,
} from './policy';

/** Durable supervisor with a dedicated, incident-scoped tool set. */
export class GoalSupervisorService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  stop = async (graph: GoalGraphSnapshot) => {
    const state = graph.goal.config?.supervisorState;
    if (!state) return;
    const operations = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    for (const incident of state.incidents) {
      const operation = incident.supervisorOperationId
        ? await operations.findById(incident.supervisorOperationId)
        : await operations.findByTopicSourceMessage(
            state.topicId,
            `msg_goal_supervisor_${incident.id}`,
          );
      if (!operation) {
        if (incident.status !== 'diagnosing') continue;
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Supervisor dispatch is unconfirmed; Goal was not deleted',
        });
      }
      if (['done', 'error', 'interrupted'].includes(operation.status)) continue;
      const result = await new AiAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      }).interruptTask({ operationId: operation.id, topicId: state.topicId });
      if (!result.success || result.deviceCancellationConfirmed === false) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Supervisor exit was not confirmed; Goal was not deleted',
        });
      }
    }
  };

  /** Runs are capped by maxIncidents, so the bounded query covers the whole diagnostic ledger. */
  usage = async (state?: GoalSupervisionState) => {
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

  private initialize = async (graph: GoalGraphSnapshot): Promise<GoalSupervisionState> => {
    const config = await resolveGoalModelConfig(this.db, this.userId);
    return this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(graph.goal.id);
      if (!goal) throw new Error('Goal not found');
      if (goal.config?.supervisorState) return goal.config.supervisorState;
      const agent = await new AgentModel(tx, this.userId, this.workspaceId).create({
        agencyConfig: { executionTarget: 'none', executionTargetSelectionPolicy: 'fixed' },
        model: config.model,
        plugins: [],
        provider: config.provider,
        systemRole: GOAL_SUPERVISOR_INSTRUCTIONS,
        title: `Goal Supervisor: ${goal.title}`.slice(0, 255),
        virtual: true,
      });
      const topic = await new TopicModel(tx, this.userId, this.workspaceId).create({
        agentId: agent.id,
        title: `Supervision: ${goal.title}`,
      });
      const state = await model.updateSupervisorState(goal.id, 0, {
        agentId: agent.id,
        incidents: [],
        topicId: topic.id,
      });
      if (!state) throw new Error('Supervisor initialization lost its claim');
      return state;
    });
  };

  /** Null hands the incident to the existing human Gate path. */
  reviewFailure = async (
    graph: GoalGraphSnapshot,
    nodeId: string,
    task: TaskItem,
  ): Promise<GoalTickResult | null> => {
    if (!graph.goal.config?.supervision?.enabled) return null;
    const goalId = graph.goal.id;
    const waiting = async (message: string): Promise<GoalTickResult> => {
      await scheduleGoalAdvance({
        delay: 5,
        goalId,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      return { goalId, message, nodeId, outcome: 'waiting_external', taskId: task.id };
    };
    const operations = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    const runs = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTaskId(
      task.id,
    );
    const latest = runs[0];
    // A kickoff that threw before writing a run has no operation to key an incident on,
    // and settlement is anchored on that run's sequence. Supervising it needs incident
    // identity and settlement redesigned, so it still reaches a person for now.
    if (!latest?.operationId) return null;
    const failedOperation = await operations.findById(latest.operationId);
    const state = graph.goal.config.supervisorState ?? (await this.initialize(graph));
    let incident = state.incidents.find((item) => item.failedOperationId === latest.operationId);
    if (!incident) {
      if (state.incidents.some((item) => item.status === 'diagnosing'))
        return waiting('Another interruption is being diagnosed');
      if (state.incidents.length >= supervisionLimit(graph.goal)) {
        for (const previous of state.incidents.filter(
          (item) => item.taskId === task.id && item.status === 'retrying',
        )) {
          await this.updateIncident(goalId, previous.id, {
            status: 'unsuccessful',
            reason: 'Recovery failed again; supervision incident budget exhausted',
          });
        }
        return null;
      }
      const taskModel = new TaskModel(this.db, this.userId, this.workspaceId);
      let eligibility = recoveryEligibility(
        graph,
        task,
        failedOperation,
        statusAuthoredByActor(await taskModel.getActivities(task.id, 20), task.status),
      );
      if (eligibility.eligible && (await this.budgetBlocked(graph))) {
        eligibility = {
          eligible: false,
          reason: 'Goal budget or authority prevents automatic recovery',
        };
      }
      incident = {
        createdAt: new Date().toISOString(),
        eligible: eligibility.eligible,
        failedOperationId: latest.operationId,
        id: latest.operationId,
        nodeId,
        reason: eligibility.reason,
        status: eligibility.eligible ? 'diagnosing' : 'escalated',
        taskId: task.id,
        taskStatus: task.status,
      };
      const claimed = await new GoalModel(
        this.db,
        this.userId,
        this.workspaceId,
      ).updateSupervisorState(goalId, state.revision, {
        ...state,
        incidents: [
          ...state.incidents.map((item) =>
            item.taskId === task.id && item.status === 'retrying'
              ? { ...item, resolvedAt: new Date().toISOString(), status: 'unsuccessful' as const }
              : item,
          ),
          incident,
        ],
      });
      if (!claimed) return waiting('Another supervisor advance claimed this incident');
      if (!incident.eligible) return null;
      // The durable incident precedes dispatch. If the process dies afterwards,
      // a sweep adopts the topic operation instead of starting another diagnosis.
      try {
        const freshGraph = await new GoalGraphModel(
          this.db,
          this.userId,
          this.workspaceId,
        ).getGraph(goalId);
        if (!freshGraph || (await this.budgetBlocked(freshGraph))) {
          await this.updateIncident(goalId, incident.id, {
            reason: 'Goal budget exhausted',
            status: 'escalated',
          });
          return null;
        }
        const modelConfig = await resolveGoalModelConfig(this.db, this.userId);
        const result = await new AiAgentService(this.db, this.userId, {
          workspaceId: this.workspaceId,
        }).execAgent({
          agentId: state.agentId,
          appContext: { topicId: state.topicId },
          clientIds: { userMessageId: `msg_goal_supervisor_${incident.id}` },
          autoStart: true,
          disableSelfFeedbackIntentTool: true,
          exclusivePluginIds: [GoalSupervisorIdentifier],
          instructions: GOAL_SUPERVISOR_INSTRUCTIONS,
          maxSteps: 16,
          model: modelConfig.model,
          prompt: buildGoalSupervisorPrompt({
            failedOperation: { error: failedOperation?.error, id: latest.operationId },
            goal: { requirement: graph.goal.requirement, title: graph.goal.title },
            goalId,
            incidentId: incident.id,
            previousIncidents: claimed.incidents.slice(-5),
            task: {
              description: task.description,
              error: task.error,
              id: task.id,
              name: task.name,
            },
            recentHandoffs: runs
              .slice(0, 3)
              .map((run) => ({ handoff: run.handoff, topicId: run.topicId })),
            workVersions: graph.workVersions.filter((work) => work.nodeId === nodeId),
          }),
          provider: modelConfig.provider,
          userInterventionConfig: { approvalMode: 'headless' },
        });
        await this.updateIncident(goalId, incident.id, {
          supervisorOperationId: result.operationId,
        });
      } catch (error) {
        console.error('[goal:supervisor] diagnostic dispatch failed', error);
        // A lost response may already have created the operation. Let the next
        // sweep adopt it before deciding that the diagnosis failed.
      }
      return waiting('Supervisor is diagnosing the interruption');
    }
    if (incident.status !== 'diagnosing') return null;

    const supervisorOperationId =
      incident.supervisorOperationId ??
      (
        await operations.findByTopicSourceMessage(
          state.topicId,
          `msg_goal_supervisor_${incident.id}`,
        )
      )?.id;
    if (supervisorOperationId && !incident.supervisorOperationId) {
      await this.updateIncident(goalId, incident.id, { supervisorOperationId });
    }
    const operation = supervisorOperationId
      ? await operations.findById(supervisorOperationId)
      : undefined;
    const expired =
      Date.now() - new Date(incident.createdAt).getTime() > SUPERVISOR_DIAGNOSIS_TIMEOUT_MS;
    if (!operation || ['idle', 'running'].includes(operation.status)) {
      if (!expired) return waiting('Waiting for supervisor diagnosis');
      await this.updateIncident(goalId, incident.id, {
        reason: 'Supervisor diagnosis timed out; no recovery was applied',
        status: 'escalated',
      });
      return null;
    }
    if (operation.status !== 'done') {
      await this.updateIncident(goalId, incident.id, {
        reason: 'Supervisor could not complete the diagnosis',
        status: 'escalated',
      });
      return null;
    }
    // Only a scoped tool action is authority; prose/JSON in a final answer is not.
    const fresh = await new GoalModel(this.db, this.userId, this.workspaceId).findById(goalId);
    const diagnosis = fresh?.config?.supervisorState?.incidents.find(
      (item) => item.id === incident.id,
    )?.resolution;
    if (!diagnosis) {
      await this.updateIncident(goalId, incident.id, {
        reason: 'Supervisor did not submit a recovery action through its tools',
        status: 'escalated',
      });
      return null;
    }
    if (diagnosis.action === 'escalate') {
      await this.updateIncident(goalId, incident.id, {
        reason: diagnosis.reason,
        recoveryInstruction: diagnosis.instruction,
        status: 'escalated',
      });
      return null;
    }

    // Revalidate current authority, failure identity and budgets. A diagnosis
    // may finish after a user pause, manual retry, cancellation or new Gate.
    const applied = await this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (!goal?.config?.supervisorState) return false;
      const currentGraph = await new GoalGraphModel(tx, this.userId, this.workspaceId).getGraph(
        goalId,
      );
      const currentTask = await new TaskModel(tx, this.userId, this.workspaceId).findById(task.id);
      const currentRuns = await new TaskTopicModel(tx, this.userId, this.workspaceId).findByTaskId(
        task.id,
      );
      const current = goal.config.supervisorState;
      const ownIncident = current.incidents.find((item) => item.id === incident.id);
      if (
        !currentGraph ||
        !currentTask ||
        ownIncident?.status !== 'diagnosing' ||
        currentRuns[0]?.operationId !== incident.failedOperationId ||
        !recoveryEligibility(
          currentGraph,
          currentTask,
          failedOperation,
          statusAuthoredByActor(
            await new TaskModel(tx, this.userId, this.workspaceId).getActivities(task.id, 20),
            currentTask.status,
          ),
        ).eligible ||
        (await new GoalSupervisorService(tx, this.userId, this.workspaceId).budgetBlocked(
          currentGraph,
        ))
      )
        return false;
      // A diagnosis takes minutes, so claim against the status the incident was
      // opened on. Re-reading first and comparing against that would swap whatever
      // the person chose in the meantime.
      if (!RECOVERABLE_TASK_STATUSES.has(currentTask.status)) return false;
      // An incident persisted before this field existed cannot say what it opened
      // on, so it cannot show the row is unchanged. Claiming against a later read
      // would restore the race this closes; a rolling deploy leaves at most the
      // handful mid-diagnosis, and they escalate rather than retry silently.
      if (!ownIncident.taskStatus) return false;
      const changed = await claimGoalTask(
        new TaskModel(tx, this.userId, this.workspaceId),
        // The status this incident opened on, so anything a person did across the
        // whole diagnosis wins the race rather than only a change since this tick.
        { id: task.id, status: ownIncident.taskStatus },
        'backlog',
        { error: null },
      );
      if (!changed) return false;
      await model.updateSupervisorState(goalId, current.revision, {
        ...current,
        incidents: current.incidents.map((item) =>
          item.id === incident.id
            ? {
                ...item,
                reason: diagnosis.reason,
                recoveryInstruction: diagnosis.instruction,
                status: 'retrying' as const,
              }
            : item,
        ),
      });
      return true;
    });
    if (!applied) {
      // A concurrent advance can have already applied the recommendation.
      const fresh = await new GoalModel(this.db, this.userId, this.workspaceId).findById(goalId);
      if (
        fresh?.config?.supervisorState?.incidents.find((item) => item.id === incident.id)
          ?.status === 'retrying'
      ) {
        return waiting('Supervisor recovery already queued');
      }
      await this.updateIncident(goalId, incident.id, {
        reason: 'Recovery preconditions changed; no recovery was applied',
        status: 'escalated',
      });
      return null;
    }
    return {
      goalId,
      message: 'Supervisor queued recovery within the original Task scope',
      nodeId,
      outcome: 'advanced',
      taskId: task.id,
    };
  };

  private budgetBlocked = async (graph: GoalGraphSnapshot) => {
    const { goal } = graph;
    const spend = await new TaskTopicModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).sumRunCostByTaskIds(graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : [])));
    const usage = await this.usage(goal.config?.supervisorState);
    return (
      goal.status !== 'running' ||
      graph.decisions.some((decision) => decision.status === 'pending') ||
      (goal.maxRounds !== null && spend.runs >= goal.maxRounds) ||
      (goal.maxTotalCost !== null &&
        spend.totalCost + usage.totalCost >= Number(goal.maxTotalCost)) ||
      (!!goal.config?.schedule?.deadline &&
        Date.now() >= new Date(goal.config.schedule.deadline).getTime())
    );
  };

  updateIncident = async (goalId: string, id: string, patch: Partial<GoalSupervisionIncident>) => {
    await this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      const state = goal?.config?.supervisorState;
      if (!state) return;
      await model.updateSupervisorState(goalId, state.revision, {
        ...state,
        incidents: state.incidents.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                ...(['recovered', 'escalated', 'unsuccessful', 'human_resumed'].includes(
                  patch.status ?? '',
                )
                  ? { resolvedAt: new Date().toISOString() }
                  : {}),
              }
            : item,
        ),
      });
    });
  };

  recoveryInstruction = (graph: GoalGraphSnapshot, taskId: string) => {
    const incident = graph.goal.config?.supervisorState?.incidents.findLast(
      (item) => item.taskId === taskId && item.status === 'retrying',
    );
    return incident
      ? `Goal Supervisor recovery of ${incident.failedOperationId}. Continue the SAME Task under its original acceptance criteria. First verify existing checkpoints, outputs and any externally committed effects. Reuse valid work; do not repeat completed training or blindly replay side effects. If an external commit cannot be checked, stop and report that uncertainty.\n${incident.recoveryInstruction}`
      : undefined;
  };

  recordDispatch = async (graph: GoalGraphSnapshot, taskId: string, operationId: string) => {
    const incident = graph.goal.config?.supervisorState?.incidents.findLast(
      (item) => item.taskId === taskId && item.status === 'retrying',
    );
    if (incident && !incident.recoveryOperationId) {
      await this.updateIncident(graph.goal.id, incident.id, { recoveryOperationId: operationId });
    }
  };

  recordProgress = async (
    graph: GoalGraphSnapshot,
    taskId: string,
    human = false,
    acceptedOperationId?: string,
  ) => {
    for (const incident of graph.goal.config?.supervisorState?.incidents ?? []) {
      if (
        incident.taskId !== taskId ||
        !(human
          ? ['diagnosing', 'retrying'].includes(incident.status)
          : incident.status === 'retrying')
      )
        continue;
      if (!human) {
        if (!acceptedOperationId) continue;
        const runs = await new TaskTopicModel(this.db, this.userId, this.workspaceId).findByTaskId(
          taskId,
        );
        const failed = runs.find((run) => run.operationId === incident.failedOperationId);
        const delivered = runs.find(
          (run) => run.operationId === acceptedOperationId && run.status === 'completed',
        );
        // Only the delivery the coordinator actually consumed counts. A newer
        // cancelled attempt cannot take credit for an older accepted result.
        if (!failed || !delivered || delivered.seq <= failed.seq) continue;
        const recoveryRuns = runs.filter((run) => run.seq > failed.seq && run.seq <= delivered.seq);
        if (recoveryRuns.some((run) => run.trigger !== 'goal')) continue;
        // Also reconstructs attribution after dispatch succeeded but the process
        // died before recordDispatch. TaskRunner persists the goal trigger.
        await this.updateIncident(graph.goal.id, incident.id, {
          recoveryOperationId: acceptedOperationId,
          status: 'recovered',
        });
      } else {
        await this.updateIncident(graph.goal.id, incident.id, { status: 'human_resumed' });
      }
    }
  };
}
