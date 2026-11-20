import { GOAL_MARK_KINDS } from '@lobechat/const/goal';
import { and, eq, inArray } from 'drizzle-orm';

import { goals } from '../schemas/goal';
import { goalNodes } from '../schemas/goalGraph';
import { tasks, taskTopics } from '../schemas/task';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** The Goal Task node a run works for, found from the run's operation. */
export interface GoalMarkRunNode {
  /** The agent the Task is assigned to: the author of what the run marks. */
  agentId?: string;
  goalId: string;
  nodeId: string;
  taskId: string;
}

/**
 * The reads and writes Goal marks need beyond the ordinary graph writes.
 *
 * A mark is created and linked through `GoalGraphModel`, which keeps the audit
 * trail; this model only resolves which Task node a run belongs to, and stores
 * the confidence derived from the runs that confirmed or refuted a mark.
 */
export class GoalMarkModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals);

  /**
   * The Task node whose run `operationId` is. Only a run of a Task bound to a
   * Goal node resolves; a subtask's run, or one outside any Goal, does not.
   */
  findRunNode = async (operationId: string): Promise<GoalMarkRunNode | undefined> => {
    const [row] = await this.db
      .select({
        agentId: tasks.assigneeAgentId,
        goalId: goalNodes.goalId,
        nodeId: goalNodes.id,
        taskId: tasks.id,
      })
      .from(taskTopics)
      .innerJoin(tasks, eq(tasks.id, taskTopics.taskId))
      .innerJoin(goalNodes, eq(goalNodes.taskId, tasks.id))
      .innerJoin(goals, eq(goals.id, goalNodes.goalId))
      .where(
        and(
          eq(taskTopics.operationId, operationId),
          eq(taskTopics.userId, this.userId),
          this.ownership(),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    return { ...row, agentId: row.agentId ?? undefined };
  };

  /** Store a mark's derived confidence; other node kinds are left alone. */
  setConfidence = async (goalId: string, nodeId: string, confidence: number) => {
    const [goal] = await this.db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goalId), this.ownership()))
      .limit(1);
    if (!goal) return undefined;
    const [node] = await this.db
      .update(goalNodes)
      .set({ confidence: confidence.toFixed(3), updatedAt: new Date() })
      .where(
        and(
          eq(goalNodes.goalId, goalId),
          eq(goalNodes.id, nodeId),
          inArray(goalNodes.kind, [...GOAL_MARK_KINDS]),
        ),
      )
      .returning({ id: goalNodes.id });
    return node;
  };
}
