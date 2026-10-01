import { GoalReportApiName, GoalReportIdentifier } from '@lobechat/builtin-tool-goal/report';
import { isHeterogeneousAgentModelId } from '@lobechat/const';
import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  GOAL_COORDINATOR_ACTOR_ID,
  GOAL_REPORT_TASK_TITLE,
} from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalReportDispatch, GoalReportTrigger } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { TaskService } from '../task';
import { TaskRunnerService } from '../taskRunner';
import { buildGoalReportInstruction, decideGoalReport } from './report';

const REPORT_MAX_STEPS = 40;
const TASK_DESCRIPTION_MAX_LENGTH = 255;

export class GoalReportService {
  private readonly coordinatorGraph: GoalGraphModel;
  private readonly taskModel: TaskModel;
  private readonly taskTopicModel: TaskTopicModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.coordinatorGraph = new GoalGraphModel(db, userId, workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  /**
   * Dispatch the wrap-up run when the Goal-level acceptance has ended and no
   * wrap-up was dispatched for that result yet.
   *
   * Best-effort by contract: the wrap-up never takes part in the Goal's status,
   * so a failure here is recorded on the dispatch receipt and swallowed.
   */
  dispatchIfDue = async (goalId: string): Promise<GoalReportDispatch | undefined> => {
    const graph = await this.coordinatorGraph.getGraph(goalId);
    if (!graph) return undefined;
    const decision = decideGoalReport(graph);
    if (!decision.dispatch) return undefined;

    // Claim the result under the goal row lock, so two coordinators reading the
    // same ended acceptance dispatch exactly one wrap-up.
    const claimed = await this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      if (!goal || goal.config?.report?.acceptanceKey === decision.key) return undefined;

      const writer = new GoalGraphModel(tx, this.userId, this.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      });
      // A later result reuses the wrap-up node this Goal already recorded; it is
      // never looked up by title, which any task could share.
      const recorded = goal.config?.report?.nodeId;
      const existing = recorded ? graph.nodes.find((node) => node.id === recorded) : undefined;
      const node =
        existing ??
        (await writer.createNode(goalId, {
          description:
            'Wrap-up: turn the finished Goal graph into a chaptered storyline and a written report. Does not affect the Goal status.',
          kind: 'task',
          priority: -2,
          status: 'proposed',
          title: GOAL_REPORT_TASK_TITLE,
        }));
      if (!node) return undefined;
      if (!existing) {
        const acceptance = graph.nodes.find(
          (candidate) =>
            candidate.kind === 'task' && candidate.title === GOAL_ACCEPTANCE_TASK_TITLE,
        );
        if (acceptance) await writer.createEdge(goalId, node.id, acceptance.id, 'depends_on');
      }

      const dispatch: GoalReportDispatch = {
        acceptanceKey: decision.key,
        dispatchedAt: new Date().toISOString(),
        nodeId: node.id,
        taskId: node.taskId ?? undefined,
        trigger: decision.trigger,
      };
      await model.update(goalId, { config: { ...goal.config, report: dispatch } });
      return dispatch;
    });
    if (!claimed) return undefined;

    try {
      const started = await this.startRun(graph, claimed, decision.trigger);
      return this.recordDispatch(goalId, claimed.acceptanceKey, started);
    } catch (error) {
      console.error('[GoalReportService] wrap-up dispatch failed:', error);
      return this.recordDispatch(goalId, claimed.acceptanceKey, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  private startRun = async (
    graph: GoalGraphSnapshot,
    dispatch: GoalReportDispatch,
    trigger: GoalReportTrigger,
  ): Promise<Partial<GoalReportDispatch>> => {
    const goalId = graph.goal.id;
    // A re-run keeps whoever the Task is already assigned to.
    const assigneeAgentId = dispatch.taskId
      ? ((await this.taskModel.findById(dispatch.taskId))?.assigneeAgentId ?? undefined)
      : await this.resolveAssignee(graph);
    const instruction = buildGoalReportInstruction(
      graph,
      trigger,
      (await this.isHeterogeneousAgent(assigneeAgentId))
        ? { kind: 'cli' }
        : {
            kind: 'tool',
            toolName: `${GoalReportIdentifier}.${GoalReportApiName.submitGoalReport}`,
          },
    );

    let taskId = dispatch.taskId;
    if (taskId) {
      // A new acceptance result: rewrite the same Task for the new skeleton and
      // run it again, which appends a report version instead of a second Task.
      for (const topic of await this.taskTopicModel.findRunningByTaskIds([taskId])) {
        if (topic.topicId)
          await new TaskService(this.db, this.userId, this.workspaceId)
            .cancelTopic(topic.topicId)
            .catch(() => {});
      }
      await this.taskModel.update(taskId, { error: null, instruction, status: 'backlog' });
    } else {
      const task = await new TaskService(this.db, this.userId, this.workspaceId).createTask({
        assigneeAgentId,
        config: { checkpoint: { topic: { after: false } } },
        description: `Wrap-up report of ${graph.goal.title}`.slice(0, TASK_DESCRIPTION_MAX_LENGTH),
        instruction,
        name: GOAL_REPORT_TASK_TITLE,
        projectId: graph.goal.projectId ?? undefined,
      });
      const bound = await this.coordinatorGraph.bindTask(goalId, dispatch.nodeId, task.id);
      if (!bound) {
        await this.taskModel.delete(task.id);
        throw new Error('Wrap-up node was bound by another coordinator');
      }
      taskId = task.id;
      // Kept on the receipt before the run starts, so a run that fails to start
      // still names the Task the page can point at.
      await this.recordDispatch(goalId, dispatch.acceptanceKey, { taskId });
    }
    await this.coordinatorGraph.updateNodeStatus(
      goalId,
      dispatch.nodeId,
      'active',
      `Writing the Goal report (${trigger})`,
    );

    const run = await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
      additionalPluginIds: [GoalReportIdentifier],
      maxSteps: REPORT_MAX_STEPS,
      taskId,
      trigger: 'goal',
    });
    return { operationId: run.operationId, taskId };
  };

  /** The goal agent narrates its own Goal; the executor is the fallback. */
  private resolveAssignee = async (graph: GoalGraphSnapshot) => {
    const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
    for (const id of [graph.goal.agentId, graph.goal.config?.taskAgentId]) {
      if (id && (await agentModel.existsById(id))) return id;
    }
    return undefined;
  };

  /**
   * Heterogeneous agents run on a device and never receive server tools such as
   * the report tool, so their wrap-up submits through the `lh` CLI. Same test
   * the agent runtime uses to route a run to the device.
   */
  private isHeterogeneousAgent = async (agentId?: string) => {
    if (!agentId) return false;
    const agent = await new AgentModel(this.db, this.userId, this.workspaceId).getAgentConfigById(
      agentId,
    );
    return (
      !!agent?.agencyConfig?.heterogeneousProvider?.type ||
      (!!agent?.model && isHeterogeneousAgentModelId(agent.model))
    );
  };

  private recordDispatch = async (
    goalId: string,
    acceptanceKey: string,
    patch: Partial<GoalReportDispatch>,
  ) =>
    this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      const current = goal?.config?.report;
      // A newer result may have claimed the receipt meanwhile; leave it alone.
      if (!goal || !current || current.acceptanceKey !== acceptanceKey) return current;
      const report = { ...current, ...patch };
      await model.update(goalId, { config: { ...goal.config, report } });
      return report;
    });
}
