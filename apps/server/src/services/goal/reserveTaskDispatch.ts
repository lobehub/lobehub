import { TRPCError } from '@trpc/server';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import {
  acceptanceEvidenceVersion,
  currentAcceptanceNode,
  isGoalAcceptanceNode,
} from './acceptanceLifecycle';
import { GoalManagerService } from './manager';
import { isGoalReportNode } from './report';
import { GoalSupervisorService } from './supervisor';

/** Reserve a visible Goal run before local scheduling or device dispatch can execute it. */
export const reserveGoalTaskDispatch = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  taskId: string,
  operationId: string,
  continueTopicId?: string,
) =>
  db.transaction(async (tx) => {
    const goals = new GoalModel(tx, userId, workspaceId);
    const owner = await goals.findByGraphTask(taskId);
    if (!owner) return false;
    const goal = await goals.lockById(owner.id);
    const graph = await new GoalGraphModel(tx, userId, workspaceId).getGraph(owner.id);
    const node = graph?.nodes.find((candidate) => candidate.taskId === taskId);
    if (graph && node && isGoalReportNode(graph, node)) return false;
    const deny = () => {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Goal constraints changed before dispatch; this Task operation was not started.',
      });
    };
    if (
      !goal ||
      !graph ||
      !node ||
      goal.status !== 'running' ||
      graph.decisions.some((decision) => decision.status === 'pending') ||
      ['retired', 'rejected', 'resolved'].includes(node.status)
    )
      return deny();
    const lifecycle = goal.config?.acceptance?.lifecycle;
    if (
      isGoalAcceptanceNode(graph, node) &&
      (currentAcceptanceNode(graph)?.id !== node.id ||
        (lifecycle &&
          (lifecycle.evidenceVersion !== acceptanceEvidenceVersion(graph) ||
            lifecycle.history.some(
              (entry) => entry.nodeId === node.id && entry.verdict === 'failed',
            ))))
    )
      return deny();
    if (goal.config?.schedule?.deadline && Date.now() >= Date.parse(goal.config.schedule.deadline))
      return deny();
    const topics = new TaskTopicModel(tx, userId, workspaceId);
    const taskModel = new TaskModel(tx, userId, workspaceId);
    if (!(await taskModel.lockForUpdate(taskId))) return deny();
    const task = await taskModel.findById(taskId);
    if (!task || task.status !== 'running') return deny();
    const operation = await new AgentOperationModel(tx, userId, workspaceId).findById(operationId);
    if (!operation?.topicId || operation.taskId !== taskId) return deny();
    const prior = await topics.findByTaskId(taskId);
    if (
      prior.some(
        (run) =>
          run.status === 'running' &&
          run.operationId !== operationId &&
          run.topicId !== continueTopicId,
      )
    )
      return deny();
    const existing = prior.find((run) => run.operationId === operationId);
    if (existing)
      return existing.status === 'running' && prior[0]?.operationId === operationId ? true : deny();
    const [spend, management, supervision] = await Promise.all([
      topics.sumRunCostByTaskIds(
        graph.nodes.flatMap((candidate) => (candidate.taskId ? [candidate.taskId] : [])),
      ),
      new GoalManagerService(tx, userId, workspaceId).usage(goal.id, goal.config?.managerState),
      new GoalSupervisorService(tx, userId, workspaceId).usage(goal.config?.supervisorState),
    ]);
    if (
      (goal.maxTotalCost !== null &&
        spend.totalCost + management.totalCost + supervision.totalCost >=
          Number(goal.maxTotalCost)) ||
      (goal.maxRounds !== null && spend.runs >= goal.maxRounds)
    )
      return deny();
    if (continueTopicId) {
      if (operation.topicId !== continueTopicId) return deny();
      await topics.updateStatus(taskId, continueTopicId, 'running');
      await topics.updateOperationId(taskId, continueTopicId, operationId);
    } else {
      await taskModel.incrementTopicCount(taskId);
      await topics.add(taskId, operation.topicId, {
        operationId,
        seq: (task.totalTopics ?? 0) + 1,
        trigger: 'goal',
      });
    }
    await taskModel.updateCurrentTopic(taskId, operation.topicId);
    if (lifecycle && currentAcceptanceNode(graph)?.id === node.id)
      await goals.updateAcceptanceLifecycle(goal.id, { ...lifecycle, operationId });
    return true;
  });
