import type { GoalItem } from '@lobechat/types';
import { resolveAgentModelSelectionPolicy } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';

import { isResourceAuthorOrAdmin } from '../resourcePermission';
import { resolveMissingTaskModelConfig } from '../task/modelSnapshot';
import { GoalManagerService } from './manager';

/** Who does the goal's Tasks: its dedicated executor, else the goal agent itself. */
export const goalTaskAgentId = (goal: Pick<GoalItem, 'agentId' | 'config'>) =>
  goal.config?.taskAgentId ?? goal.agentId ?? undefined;

const goalNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

type ModelConfig = { model: string; provider: string };

/**
 * Who works on a goal and with which model: the goal agent that supervises and
 * plans, the executor its Tasks go to, and the model planning turns run on.
 */
export class GoalAssignmentService {
  private agentModel: AgentModel;
  private goalModel: GoalModel;
  private graphModel: GoalGraphModel;
  private taskModel: TaskModel;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.goalModel = new GoalModel(db, userId, workspaceId);
    this.graphModel = new GoalGraphModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
  }

  private assertUsable = (agentId: string) =>
    assertAgentUsableBy(this.db, agentId, { userId: this.userId, workspaceId: this.workspaceId });

  /**
   * Hand the goal to a different agent. The goal agent supervises: it owns the
   * goal page and list entry and runs every planning turn. When it also does
   * the goal's own Tasks (no separate `taskAgentId`), every Task the
   * coordinator creates from here on goes to the new agent and — unless the
   * caller opts out — the unfinished ones move with it. A goal whose Tasks go
   * to a dedicated executor keeps them there; see `setTaskAgent`.
   *
   * The management conversation moves with supervision: it lives in the goal
   * agent's own history, so it is re-created for the new agent here instead of
   * being left pointing at the previous agent's topic until the next claim.
   */
  setAgent = async (
    goalId: string,
    agentId: string,
    options?: { goalOnly?: boolean },
  ): Promise<{ goal: GoalItem; reassignedTaskIds: string[] }> => {
    await this.assertUsable(agentId);
    const previous = await this.goalModel.findById(goalId);
    if (!previous) throw goalNotFound();
    const updated = await this.goalModel.update(goalId, { agentId });
    if (!updated) throw goalNotFound();
    // Without a dedicated executor the goal agent also does the Tasks, so the
    // executor changed too and its Task model goes with the planning one.
    const goal =
      previous.agentId === agentId
        ? updated
        : await this.dropModelOverride(
            updated,
            updated.config?.taskAgentId ? ['planning'] : ['planning', 'task'],
          );

    // The receipt carries the management topic, so the caller must get the row
    // with the migrated one — not the copy read before the handoff.
    const migrated = await new GoalManagerService(
      this.db,
      this.userId,
      this.workspaceId,
    ).moveConversationTo(goalId, agentId);

    const reassignedTaskIds = await this.followGoalAgent(goal, agentId, options?.goalOnly);
    return {
      goal: migrated ? ((await this.goalModel.findById(goalId)) ?? goal) : goal,
      reassignedTaskIds,
    };
  };

  /**
   * Pick the model the goal agent plans with, or fall back to that agent's own
   * model with `null`. Only planning turns read it — Tasks keep their own model
   * — and a turn already running keeps the model it started on.
   */
  setModel = async (goalId: string, modelConfig: ModelConfig | null): Promise<GoalItem> =>
    this.writeModelOverride(goalId, modelConfig, 'planning');

  /**
   * Pick the model the goal's Tasks run on, or fall back to their executor's own
   * model with `null`. Tasks the coordinator creates from here on are pinned to
   * it, and unfinished ones switch with it; a run already going keeps its model.
   */
  setTaskModel = async (goalId: string, modelConfig: ModelConfig | null): Promise<GoalItem> => {
    const goal = await this.writeModelOverride(goalId, modelConfig, 'task');
    const executor = await this.resolveTaskAssignee(goal);
    const next = modelConfig ?? (executor ? await this.agentModelOf(executor) : undefined);
    if (next) {
      const { taskModel, tasks } = await this.unfinishedTasks(goalId);
      for (const task of tasks) await taskModel.updateTaskConfig(task.id, next);
    }
    return goal;
  };

  /**
   * Check the slot's agent and write its override under the goal row lock, so
   * an agent handoff racing this write cannot slip in between: the check always
   * sees the agent the override will actually apply to.
   */
  private writeModelOverride = async (
    goalId: string,
    modelConfig: ModelConfig | null,
    slot: 'planning' | 'task',
  ): Promise<GoalItem> => {
    const goal = await this.db.transaction(async (tx) => {
      const model = new GoalModel(tx, this.userId, this.workspaceId);
      const current = await model.lockById(goalId);
      if (!current) throw goalNotFound();
      if (modelConfig) {
        // Reads inside the transaction go through it, not around it.
        const scoped = new GoalAssignmentService(tx, this.userId, this.workspaceId);
        const agentId =
          slot === 'task' ? await scoped.resolveTaskAssignee(current) : current.agentId;
        if (agentId) await scoped.assertModelSelectable(agentId);
      }
      return model.updateModelConfig(goalId, modelConfig, slot);
    });
    if (!goal) throw goalNotFound();
    return goal;
  };

  /**
   * A model override was picked against the previous agent — its provider, or a
   * runtime that agent does not share — so a new agent starts from its own.
   */
  dropModelOverride = async (goal: GoalItem, slots: ('planning' | 'task')[]) => {
    let current = goal;
    for (const slot of slots) {
      const [model, provider] =
        slot === 'task'
          ? [current.config?.taskModel, current.config?.taskProvider]
          : [current.config?.model, current.config?.provider];
      if (model || provider)
        current = (await this.goalModel.updateModelConfig(goal.id, null, slot)) ?? current;
    }
    return current;
  };

  /**
   * A goal override is an explicit per-run model, which outranks an Agent's
   * policy at run time. So when the author pinned the model of a public
   * Workspace Agent (`fixed`), only they or a Workspace admin may override it
   * here — the same people who could change it on the Agent itself.
   */
  private assertModelSelectable = async (agentId: string) => {
    const agent = await this.db.query.agents.findFirst({
      columns: { agencyConfig: true, userId: true, visibility: true, workspaceId: true },
      where: eq(agents.id, agentId),
    });
    if (!agent || agent.userId === this.userId) return;
    const workspaceId = agent.workspaceId ?? undefined;
    const visibility = (agent.visibility as 'private' | 'public' | null) ?? 'public';
    const policy = resolveAgentModelSelectionPolicy({
      agencyConfig: agent.agencyConfig ?? undefined,
      visibility,
      workspaceId,
    });
    if (policy !== 'fixed' || !workspaceId || visibility === 'private') return;
    const canManage = await isResourceAuthorOrAdmin({
      db: this.db,
      meta: { userId: agent.userId, visibility, workspaceId },
      resourceType: 'agent',
      userId: this.userId,
      workspaceId,
    });
    if (!canManage)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "This Agent's author fixed its model; only they or an admin can override it",
      });
  };

  /** The model a Task assigned to this agent would be created with. */
  private agentModelOf = async (agentId: string): Promise<Partial<ModelConfig> | undefined> => {
    const info = await this.agentModel.getAgentSnapshotForTaskCreate(agentId);
    return info?.snapshot
      ? resolveMissingTaskModelConfig({}, info.snapshot, info.modelOverrideProvider)
      : undefined;
  };

  /**
   * After the goal agent changed: when that agent also does the goal's Tasks,
   * unfinished ones follow it unless the caller keeps them (`goalOnly`). A goal
   * with a dedicated executor keeps its Tasks there.
   */
  followGoalAgent = async (
    goal: Pick<GoalItem, 'config' | 'id'>,
    agentId: string,
    goalOnly?: boolean,
  ) => (goalOnly || goal.config?.taskAgentId ? [] : this.reassignUnfinishedTasks(goal.id, agentId));

  /**
   * Route the goal's Tasks to a dedicated executor, or back to the goal agent
   * with `null`. The goal agent keeps supervising either way. Unfinished Tasks
   * move with the change unless the caller opts out.
   */
  setTaskAgent = async (
    goalId: string,
    agentId: string | null,
    options?: { goalOnly?: boolean },
  ): Promise<{ goal: GoalItem; reassignedTaskIds: string[] }> => {
    if (agentId) await this.assertUsable(agentId);
    const current = await this.goalModel.findById(goalId);
    if (!current) throw goalNotFound();
    // Naming the goal agent itself is the same as clearing: one agent, one slot.
    const updated = await this.goalModel.updateTaskAgentId(
      goalId,
      agentId && agentId !== current.agentId ? agentId : null,
    );
    if (!updated) throw goalNotFound();
    const goal =
      goalTaskAgentId(updated) === goalTaskAgentId(current)
        ? updated
        : await this.dropModelOverride(updated, ['task']);

    const assignee = goalTaskAgentId(goal);
    const reassignedTaskIds =
      options?.goalOnly || !assignee ? [] : await this.reassignUnfinishedTasks(goalId, assignee);
    return { goal, reassignedTaskIds };
  };

  /**
   * The agent the next coordinator-created Task goes to.
   *
   * `taskAgentId` lives in JSON, so deleting the executor does not null it the
   * way the `agent_id` foreign key is nulled. Handing that stale id to
   * `createTask` fails with NOT_FOUND on every tick and the goal can never
   * create work again — so a missing executor falls back to the goal agent.
   */
  resolveTaskAssignee = async (goal: GoalItem) => {
    const taskAgentId = goal.config?.taskAgentId;
    if (taskAgentId && !(await this.agentModel.existsById(taskAgentId)))
      return goal.agentId ?? undefined;
    return goalTaskAgentId(goal);
  };

  /**
   * Snapshot the graph AFTER the goal row moved: a task the coordinator binds
   * later inherits the new assignee from the goal, and a task bound before is in
   * this snapshot — so no concurrently created task can slip through the
   * handoff still pointing at the previous agent. A Task mid-run keeps its
   * current operation; `runTask` reads the assignee at its next dispatch.
   */
  private reassignUnfinishedTasks = async (goalId: string, agentId: string) => {
    // A moved Task takes its new executor's model, the one it would have been
    // created with; the previous executor's snapshot may name another runtime.
    const model = await this.agentModelOf(agentId);
    const { taskModel, tasks } = await this.unfinishedTasks(goalId);
    const reassigned: string[] = [];
    for (const task of tasks) {
      if (task.assigneeAgentId === agentId) continue;
      await taskModel.update(task.id, { assigneeAgentId: agentId });
      if (model) await taskModel.updateTaskConfig(task.id, model);
      reassigned.push(task.id);
    }
    return reassigned;
  };

  /**
   * Give Tasks that were just handed to `agentId` outside this service (a
   * restart with a new agent) that agent's model, as a reassignment would.
   */
  applyExecutorModel = async (
    goal: Pick<GoalItem, 'userId'>,
    taskIds: string[],
    agentId: string,
  ) => {
    const model = await this.agentModelOf(agentId);
    if (!model || taskIds.length === 0) return;
    const taskModel = this.taskModelFor(goal);
    for (const taskId of taskIds) await taskModel.updateTaskConfig(taskId, model);
  };

  /**
   * Tasks belong to the goal's owner, so a Workspace admin acting on someone
   * else's goal reads and writes them under the owner — the caller's own scope
   * would miss the owner's private Tasks.
   */
  private taskModelFor = (goal: Pick<GoalItem, 'userId'>) =>
    goal.userId === this.userId
      ? this.taskModel
      : new TaskModel(this.db, goal.userId, this.workspaceId);

  private unfinishedTasks = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (!graph) throw goalNotFound();
    const taskModel = this.taskModelFor(graph.goal);
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const tasks = (await taskModel.findByIds(taskIds)).filter(
      (task) => task.status !== 'completed' && task.status !== 'canceled',
    );
    return { taskModel, tasks };
  };
}
