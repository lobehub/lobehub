import { GoalModel } from '@/database/models/goal';
import type { LobeChatDatabase } from '@/database/type';
import type { CreateGoalGraphInput } from '@/server/services/goal';
import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateGoalRequest,
  GoalListQuery,
  RestartGoalRequest,
  UpdateGoalRequest,
} from '../types/goal.type';
import type { UpdateGoalConfigRequest } from '../types/goal-advanced.type';

/** The model's own default page size, kept so omitting `limit` still returns 50 rows. */
export const GOAL_LIST_DEFAULT_LIMIT = 50;

/**
 * Goals REST service.
 *
 * Thin auth-and-transport shell over the same `GoalService` / `GoalModel` the
 * `/goal` tool and the task scheduler drive, so a REST client sees exactly the
 * coordinator behaviour the product already has instead of a parallel copy of
 * it. Anything the coordinator does (dispatching tasks, opening decision gates)
 * is the service's job; this layer only decides who may ask.
 */
export class GoalRestService extends BaseService {
  protected readonly goalModel: GoalModel;
  protected readonly goalService: GoalService;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.goalModel = new GoalModel(db, userId ?? '', workspaceId);
    this.goalService = new GoalService(db, userId ?? '', workspaceId);
  }

  /**
   * Personal scope is a hard boundary: a goal is only addressable by its owner.
   * Workspace scope defers to RBAC (`AGENT_UPDATE` / `AGENT_READ`), which is the
   * same rule the tRPC surface enforces.
   */
  protected async requireGoal(id: string) {
    const goal = await this.goalModel.findById(id);
    if (!goal || (!this.workspaceId && goal.userId !== this.userId)) {
      throw this.createNotFoundError('Goal not found');
    }
    return goal;
  }

  async listGoals(query: GoalListQuery) {
    const { limit, offset } = resolvePagination(query, GOAL_LIST_DEFAULT_LIMIT);
    return this.goalModel.list({
      agentId: query.agentId,
      limit,
      offset,
      projectId: query.projectId,
      statuses: query.statuses,
      topicId: query.topicId,
    });
  }

  /** The goal plus its whole graph (nodes, edges, roll-up). */
  async getGoal(id: string) {
    await this.requireGoal(id);
    return this.goalService.graph(id);
  }

  async getSupervision(id: string) {
    await this.requireGoal(id);
    const graph = await this.goalService.graph(id);
    const state = graph.goal.config?.supervisorState;
    return {
      enabled: graph.goal.config?.supervision?.enabled ?? false,
      state,
    };
  }

  /**
   * Creating a goal means starting it — the coordinator takes over from here so
   * no client has to hold a loop open.
   */
  async createGoal(input: CreateGoalRequest) {
    const { deadline, ...rest } = input;
    const createInput: CreateGoalGraphInput = {
      ...rest,
      config: {
        ...(rest.config as CreateGoalGraphInput['config']),
        ...(deadline ? { schedule: { deadline } } : {}),
      },
    };

    const graph = await this.goalService.create(createInput);
    await scheduleGoalAdvance({
      goalId: graph.goal.id,
      trigger: 'create',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return graph;
  }

  /** Run the coordinator now and report where it stopped. */
  async advanceGoal(id: string) {
    await this.requireGoal(id);
    const { result, ticks } = await advanceGoal({
      goalId: id,
      trigger: 'manual',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return { ...result, ticks };
  }

  async pauseGoal(id: string) {
    await this.requireGoal(id);
    return this.goalService.pause(id);
  }

  async resumeGoal(id: string) {
    await this.requireGoal(id);
    const data = await this.goalService.resume(id);
    await scheduleGoalAdvance({
      goalId: id,
      trigger: 'resume',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return data;
  }

  /** Restart every unfinished task node, optionally under a different agent. */
  async restartGoal(id: string, input: RestartGoalRequest) {
    const goal = await this.requireGoal(id);
    // `AGENT_UPDATE` says the member may change goals; it does not say whose.
    // Without this any member could reset a colleague's goal and cancel its
    // live runs — the same creator-or-owner gate the tRPC mutation applies.
    await this.assertRowManageable(goal.userId, 'AGENT_UPDATE', 'goal');
    const data = await this.goalService.restart(id, { agentId: input.agentId });
    await scheduleGoalAdvance({
      goalId: id,
      trigger: 'restart',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return data;
  }

  /**
   * Apply a configuration patch in one transaction, so a part the goal refuses
   * (a turn budget on a goal with no main Agent, a model its owner cannot run)
   * leaves every other part unapplied too — the caller never sees a 400 while
   * half the patch already landed. Handing the goal or its Tasks to another
   * agent and switching models change whose work the goal is, so, like the
   * tRPC procedures, they are limited to the goal's creator or a workspace
   * owner. Returns the Tasks that moved to a new agent.
   */
  protected async applyConfig(id: string, input: UpdateGoalConfigRequest): Promise<string[]> {
    const goal = await this.requireGoal(id);
    if (
      input.agent ||
      input.taskAgent ||
      input.model !== undefined ||
      input.taskModel !== undefined
    ) {
      await this.assertRowManageable(goal.userId, 'AGENT_UPDATE', 'goal');
    }

    const reassignedTaskIds = new Set<string>();
    await this.db.transaction(async (tx) => {
      const service = new GoalService(tx, this.userId, this.workspaceId);
      if (input.requirement) await service.updateRequirement(id, input.requirement);
      if (input.budget) await service.setBudget(id, input.budget);
      if (input.agent) {
        const { reassignedTaskIds: moved } = await service.setAgent(id, input.agent.agentId, {
          goalOnly: input.agent.goalOnly,
        });
        for (const taskId of moved) reassignedTaskIds.add(taskId);
      }
      if (input.taskAgent) {
        const { reassignedTaskIds: moved } = await service.setTaskAgent(
          id,
          input.taskAgent.agentId,
          { goalOnly: input.taskAgent.goalOnly },
        );
        for (const taskId of moved) reassignedTaskIds.add(taskId);
      }
      if (input.model !== undefined) await service.setModel(id, input.model);
      if (input.taskModel !== undefined) await service.setTaskModel(id, input.taskModel);
    });

    if (input.budget) {
      // Raising a budget is how a user un-sticks a goal that stopped on one,
      // and only after the transaction committed — an enqueue must never
      // survive a rolled-back budget.
      await scheduleGoalAdvance({
        goalId: id,
        trigger: 'budget',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }

    return [...reassignedTaskIds];
  }

  /** Update the acceptance requirement and/or the budget; the subset `PATCH /goals/{id}/config` extends. */
  async updateGoal(id: string, input: UpdateGoalRequest) {
    await this.applyConfig(id, { budget: input.budget, requirement: input.requirement });
    return this.goalService.graph(id);
  }

  async deleteGoal(id: string): ServiceResult<DeletedResource> {
    const goal = await this.requireGoal(id);
    // Same rule as `restart`: visibility is not manageability, so only the
    // goal's creator (or a workspace owner) may cascade its graph away.
    await this.assertRowManageable(goal.userId, 'AGENT_UPDATE', 'goal');
    await this.goalService.delete(id);
    return { deleted: true, id };
  }
}
