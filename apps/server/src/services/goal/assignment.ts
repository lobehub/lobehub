import type { GoalItem, TaskItem } from '@lobechat/types';
import { resolveAgentModelSelectionPolicy } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { GoalRepository } from '@/database/repositories/goal';
import { agents, tasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';

import { isResourceAuthorOrAdmin } from '../resourcePermission';
import { resolveMissingTaskModelConfig } from '../task/modelSnapshot';
import { goalTaskAgentId } from './GoalService/utils';
import { GoalManagerService } from './manager';
import { assertGoalModelRunnable, goalTaskModelOverride } from './modelConfig';

const goalNotFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });

type ModelConfig = { model: string; provider: string };
type ModelSlot = 'planning' | 'task';

/**
 * The model overrides a handoff leaves stale: the planning model belongs to
 * the goal agent, the Task model to whoever actually does the Tasks — which,
 * without a dedicated executor, is the goal agent too.
 */
export const staleModelSlots = (
  previous: Pick<GoalItem, 'agentId' | 'config'>,
  next: Pick<GoalItem, 'agentId' | 'config'>,
): ModelSlot[] => [
  ...(previous.agentId === next.agentId ? [] : (['planning'] as const)),
  ...(goalTaskAgentId(previous) === goalTaskAgentId(next) ? [] : (['task'] as const)),
];

/**
 * A Task config's model keys set to `model`, or removed with `undefined` so the
 * Task inherits its executor's default — a single atomic JSONB write.
 */
const taskModelPatch = (model?: Partial<ModelConfig>) =>
  model
    ? sql`COALESCE(${tasks.config}, '{}'::jsonb) || ${JSON.stringify(model)}::jsonb`
    : sql`COALESCE(${tasks.config}, '{}'::jsonb) - 'model' - 'provider'`;

/**
 * The goal's Task model, unless it belonged to a dedicated executor that is
 * gone: a handoff clears the override with the executor, and a deleted executor
 * (Tasks fall back to the goal agent) is the same change made implicitly.
 */
const liveTaskModelOverride = (goal: GoalItem, executor: string | undefined) => {
  const dedicated = goal.config?.taskAgentId;
  return dedicated && executor !== dedicated ? {} : goalTaskModelOverride(goal.config);
};

/** Whether a Task config already carries exactly `model` (or none, for `undefined`). */
const pinsModel = (config: unknown, model?: Partial<ModelConfig>) => {
  const current = (config ?? {}) as { model?: unknown; provider?: unknown };
  return current.model === model?.model && current.provider === model?.provider;
};

/**
 * Who works on a goal and with which model: the goal agent that supervises and
 * plans, the executor its Tasks go to, and the model planning turns run on.
 */
export class GoalAssignmentService {
  private agentModel: AgentModel;
  private goalModel: GoalRepository;
  private graphModel: GoalGraphModel;
  private taskModel: TaskModel;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.goalModel = new GoalRepository(db, userId, workspaceId);
    this.graphModel = new GoalGraphModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
  }

  private assertUsable = (agentId: string) =>
    assertAgentUsableBy(this.db, agentId, { userId: this.userId, workspaceId: this.workspaceId });

  /**
   * The caller must be allowed to pick the agent, and the goal's owner must be
   * able to run it: background advances act as the owner, so a private Agent of
   * an admin acting on someone else's goal would be unreachable to every later
   * planning turn, or silently skipped as a missing executor.
   */
  assertUsableForGoal = async (goal: Pick<GoalItem, 'userId'> | string, agentId: string) => {
    await this.assertUsable(agentId);
    const ownerId =
      typeof goal === 'string' ? (await this.goalModel.findById(goal))?.userId : goal.userId;
    if (!ownerId) throw goalNotFound();
    if (ownerId === this.userId) return;
    await assertAgentUsableBy(this.db, agentId, {
      userId: ownerId,
      workspaceId: this.workspaceId,
    }).catch(() => {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "The goal's owner cannot use this Agent; pick one they have access to",
      });
    });
  };

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
    await this.assertUsableForGoal(goalId, agentId);
    // With a dedicated executor the Tasks stay where they are; otherwise the
    // goal agent does them, so the unfinished ones follow it.
    const { goal, movedTaskIds: reassignedTaskIds } = await this.handOver(
      goalId,
      (model) => model.update(goalId, { agentId }),
      async (scoped, handed) =>
        options?.goalOnly || handed.config?.taskAgentId
          ? []
          : scoped.reassignUnfinishedTasks(goalId, agentId),
    );

    // The receipt carries the management topic, so the caller must get the row
    // with the migrated one — not the copy read before the handoff.
    const migrated = await new GoalManagerService(
      this.db,
      this.userId,
      this.workspaceId,
    ).moveConversationTo(goalId, agentId);

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
  setTaskModel = async (goalId: string, modelConfig: ModelConfig | null): Promise<GoalItem> =>
    // The goal and its unfinished Tasks switch in one commit under the goal
    // lock, so an executor handoff cannot interleave and leave either stale.
    this.writeModelOverride(goalId, modelConfig, 'task', async (scoped, goal) => {
      const executor = await scoped.resolveTaskAssignee(goal);
      // Without a model to pin (an executor that inherits defaults), the Tasks
      // drop theirs, as a Task newly created for that executor would have none.
      const next =
        modelConfig ?? (executor ? await scoped.agentModelOf(executor, goal) : undefined);
      await scoped.pinUnfinishedTaskModels(goal.id, next);
    });

  /**
   * Check the slot's agent and write its override under the goal row lock, so
   * an agent handoff racing this write cannot slip in between: the check always
   * sees the agent the override will actually apply to.
   */
  private writeModelOverride = async (
    goalId: string,
    modelConfig: ModelConfig | null,
    slot: 'planning' | 'task',
    /** Runs in the same transaction after the write, still under the lock. */
    after?: (scoped: GoalAssignmentService, goal: GoalItem) => Promise<void>,
  ): Promise<GoalItem> => {
    if (modelConfig) {
      // The owner never changes, so the availability check needs no lock.
      const owner = await new GoalRepository(this.db, this.userId, this.workspaceId).findById(
        goalId,
      );
      if (!owner) throw goalNotFound();
      await assertGoalModelRunnable(this.db, owner, slot, modelConfig);
    }
    return this.db.transaction(async (tx) => {
      const model = new GoalRepository(tx, this.userId, this.workspaceId);
      const current = await model.lockById(goalId);
      if (!current) throw goalNotFound();
      // Reads inside the transaction go through it, not around it.
      const scoped = new GoalAssignmentService(tx, this.userId, this.workspaceId);
      if (modelConfig) {
        const agentId =
          slot === 'task' ? await scoped.resolveTaskAssignee(current) : current.agentId;
        if (agentId) await scoped.assertModelSelectable(agentId);
      }
      const goal = await model.updateModelConfig(goalId, modelConfig, slot);
      if (!goal) throw goalNotFound();
      await after?.(scoped, goal);
      return goal;
    });
  };

  /**
   * Pin every unfinished Task of the goal to `model`, or drop their pinned model
   * with `undefined` — one set-based write however many Tasks the goal has.
   */
  private pinUnfinishedTaskModels = async (goalId: string, model?: Partial<ModelConfig>) => {
    const { tasks: unfinished } = await this.unfinishedTasks(goalId);
    if (unfinished.length === 0) return;
    await this.db
      .update(tasks)
      .set({ config: taskModelPatch(model), updatedAt: new Date() })
      .where(
        and(
          // Ids were read through the goal owner's scope.
          inArray(
            tasks.id,
            unfinished.map((task) => task.id),
          ),
          notInArray(tasks.status, ['completed', 'canceled']),
        ),
      );
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

  /**
   * Point the goal at a new agent and drop the overrides that belonged to the
   * previous one in the same commit, so a coordinator tick can never dispatch
   * the new agent on the previous agent's model in between.
   */
  handOver = (
    goalId: string,
    write: (model: GoalRepository, current: GoalItem) => Promise<GoalItem | undefined>,
    /**
     * Moves the goal's Tasks along with the handoff, under the same lock, so a
     * Task-model write or a coordinator claim cannot land between the handoff
     * and the move. Returns the ids of the Tasks it moved.
     */
    moveTasks?: (
      scoped: GoalAssignmentService,
      goal: GoalItem,
      previous: GoalItem,
    ) => Promise<string[]>,
  ): Promise<{ goal: GoalItem; movedTaskIds: string[]; previous: GoalItem }> =>
    this.db.transaction(async (tx) => {
      const model = new GoalRepository(tx, this.userId, this.workspaceId);
      const previous = await model.lockById(goalId);
      if (!previous) throw goalNotFound();
      const updated = await write(model, previous);
      if (!updated) throw goalNotFound();
      const scoped = new GoalAssignmentService(tx, this.userId, this.workspaceId);
      const goal = await scoped.dropModelOverride(updated, staleModelSlots(previous, updated));
      const movedTaskIds = (await moveTasks?.(scoped, goal, previous)) ?? [];
      return { goal, movedTaskIds, previous };
    });

  /**
   * Move one Task to an executor and/or model in a single commit: a Task
   * claimed between the two writes would otherwise run the new executor on the
   * previous one's pinned model. `model: undefined` removes the Task's pinned
   * model so it inherits its executor's default.
   */
  private retargetTask = (
    owner: Pick<GoalItem, 'userId'>,
    taskId: string,
    change: { agentId?: string; model: Partial<ModelConfig> | undefined },
  ) =>
    this.db.transaction(async (tx) => {
      const taskModel = new TaskModel(tx, owner.userId, this.workspaceId);
      if (change.agentId) await taskModel.update(taskId, { assigneeAgentId: change.agentId });
      if (change.model) {
        await taskModel.updateTaskConfig(taskId, change.model);
        return;
      }
      // The id was read through the owner's scope.
      await tx
        .update(tasks)
        .set({ config: taskModelPatch(undefined), updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
    });

  /**
   * The model a Task assigned to this agent would be created with — read as the
   * goal's owner, who creates its Tasks and may run them on a private Agent.
   */
  private agentModelOf = async (
    agentId: string,
    owner: Pick<GoalItem, 'userId'>,
  ): Promise<Partial<ModelConfig> | undefined> => {
    const info = await this.agentModelFor(owner).getAgentSnapshotForTaskCreate(agentId);
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
    if (agentId) await this.assertUsableForGoal(goalId, agentId);
    const { goal, movedTaskIds } = await this.handOver(
      goalId,
      (model, current) =>
        // Naming the goal agent itself is the same as clearing: one agent, one slot.
        model.updateTaskAgentId(goalId, agentId && agentId !== current.agentId ? agentId : null),
      async (scoped, handed) => {
        const assignee = goalTaskAgentId(handed);
        return options?.goalOnly || !assignee
          ? []
          : scoped.reassignUnfinishedTasks(goalId, assignee);
      },
    );
    return { goal, reassignedTaskIds: movedTaskIds };
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
    // As the goal's owner: an admin acting on a member's goal cannot see the
    // member's private executor, which is still very much there.
    if (taskAgentId && !(await this.agentModelFor(goal).existsById(taskAgentId)))
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
  reassignUnfinishedTasks = async (goalId: string, agentId: string) => {
    const { goal: owner, tasks: unfinished } = await this.unfinishedTasks(goalId);
    const model = await this.expectedTaskModel(owner, agentId);
    const reassigned: string[] = [];
    for (const task of unfinished) {
      const moved = task.assigneeAgentId !== agentId;
      // A Task already on this executor may still carry a model pinned for
      // another one; it is re-pinned even though it does not move.
      if (!moved && pinsModel(task.config, model)) continue;
      await this.retargetTask(owner, task.id, { agentId: moved ? agentId : undefined, model });
      if (moved) reassigned.push(task.id);
    }
    return reassigned;
  };

  /**
   * The model a goal's Task for `executor` should be pinned to: the goal's own
   * Task model when it has one, else the model a Task created for that
   * executor would carry (the previous executor's snapshot may name another
   * runtime entirely).
   */
  private expectedTaskModel = async (
    goal: GoalItem,
    executor: string | undefined,
  ): Promise<Partial<ModelConfig> | undefined> => {
    const override = liveTaskModelOverride(goal, executor);
    if (override.model) return override;
    return executor ? this.agentModelOf(executor, goal) : undefined;
  };

  /**
   * The executor a new Task goes to and the model it is pinned to, resolved
   * together: when the dedicated executor was deleted and Tasks fall back to
   * the goal agent, the deleted executor's Task model goes with it.
   */
  newTaskAssignment = async (goal: GoalItem) => {
    const assigneeAgentId = await this.resolveTaskAssignee(goal);
    return { assigneeAgentId, model: liveTaskModelOverride(goal, assigneeAgentId) };
  };

  /**
   * Restart `candidates` onto `agentId` inside a handoff transaction: each is
   * reset to `backlog` by compare-and-swap (a Task a tick claims meanwhile is
   * skipped, not yanked out of its run) and reassigned in the same commit as
   * the handoff — re-pinned to the new executor's model when the executor
   * changed, so no tick can dispatch it on the previous executor's model.
   */
  restartTasks = async (
    goal: GoalItem,
    candidates: Pick<TaskItem, 'id' | 'status'>[],
    agentId: string,
    executorChanged: boolean,
  ): Promise<string[]> => {
    const taskModel = this.taskModelFor(goal);
    const model = executorChanged ? await this.agentModelOf(agentId, goal) : undefined;
    const restarted: string[] = [];
    for (const task of candidates) {
      const reset = await taskModel.updateStatusIfCurrent(task.id, task.status, 'backlog', {
        error: null,
      });
      if (!reset) continue;
      if (executorChanged) await this.retargetTask(goal, task.id, { agentId, model });
      else await taskModel.update(task.id, { assigneeAgentId: agentId });
      restarted.push(task.id);
    }
    return restarted;
  };

  /**
   * Align a Task the coordinator just bound with the goal as it is now: an
   * executor handoff or Task-model change that committed while the Task was
   * being created scanned the graph before the bind and missed it. Both the
   * assignee and the model are aligned — fixing only one would pair an
   * executor with another's model. Taking the goal lock orders this after any
   * such change (or that change after the bind, so it sees the Task itself).
   */
  syncBoundTask = (goalId: string, taskId: string) =>
    this.db.transaction(async (tx) => {
      const current = await new GoalRepository(tx, this.userId, this.workspaceId).lockById(goalId);
      if (!current) return;
      const scoped = new GoalAssignmentService(tx, this.userId, this.workspaceId);
      const task = await scoped.taskModelFor(current).findById(taskId);
      if (!task) return;
      const executor = await scoped.resolveTaskAssignee(current);
      const model = await scoped.expectedTaskModel(current, executor);
      const moved = !!executor && task.assigneeAgentId !== executor;
      if (!moved && pinsModel(task.config, model)) return;
      await scoped.retargetTask(current, taskId, {
        agentId: moved ? executor : undefined,
        model,
      });
    });

  /**
   * Tasks belong to the goal's owner, so a Workspace admin acting on someone
   * else's goal reads and writes them under the owner — the caller's own scope
   * would miss the owner's private Tasks.
   */
  private agentModelFor = (goal: Pick<GoalItem, 'userId'>) =>
    goal.userId === this.userId
      ? this.agentModel
      : new AgentModel(this.db, goal.userId, this.workspaceId);

  private taskModelFor = (goal: Pick<GoalItem, 'userId'>) =>
    goal.userId === this.userId
      ? this.taskModel
      : new TaskModel(this.db, goal.userId, this.workspaceId);

  private unfinishedTasks = async (goalId: string) => {
    const graph = await this.graphModel.getGraph(goalId);
    if (!graph) throw goalNotFound();
    const taskModel = this.taskModelFor(graph.goal);
    const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
    const unfinished = (await taskModel.findByIds(taskIds)).filter(
      (task) => task.status !== 'completed' && task.status !== 'canceled',
    );
    return { goal: graph.goal, tasks: unfinished };
  };
}
