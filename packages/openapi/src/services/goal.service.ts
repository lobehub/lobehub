import { GoalModel } from '@/database/models/goal';
import type { LobeChatDatabase } from '@/database/type';
import type { CreateGoalGraphInput } from '@/server/services/goal';
import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  CreateGoalRequest,
  GoalListQuery,
  RestartGoalRequest,
  UpdateGoalRequest,
} from '../types/goal.type';

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
  private readonly goalModel: GoalModel;
  private readonly goalService: GoalService;

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
  private async requireGoal(id: string) {
    const goal = await this.goalModel.findById(id);
    if (!goal || (!this.workspaceId && goal.userId !== this.userId)) {
      throw this.createNotFoundError('Goal not found');
    }
    return goal;
  }

  async listGoals(query: GoalListQuery): ServiceResult<unknown> {
    return this.goalModel.list({
      agentId: query.agentId,
      limit: query.limit,
      offset: query.offset,
      projectId: query.projectId,
      statuses: query.statuses,
      topicId: query.topicId,
    });
  }

  /** The goal plus its whole graph (nodes, edges, roll-up). */
  async getGoal(id: string): ServiceResult<unknown> {
    await this.requireGoal(id);
    return this.goalService.graph(id);
  }

  async getSupervision(id: string): ServiceResult<unknown> {
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
  async createGoal(input: CreateGoalRequest): ServiceResult<unknown> {
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
  async advanceGoal(id: string): ServiceResult<unknown> {
    await this.requireGoal(id);
    const { result, ticks } = await advanceGoal({
      goalId: id,
      trigger: 'manual',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return { ...result, ticks };
  }

  async pauseGoal(id: string): ServiceResult<unknown> {
    await this.requireGoal(id);
    return this.goalService.pause(id);
  }

  async resumeGoal(id: string): ServiceResult<unknown> {
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
  async restartGoal(id: string, input: RestartGoalRequest): ServiceResult<unknown> {
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

  /** Update the acceptance requirement and/or the budget in one call. */
  async updateGoal(id: string, input: UpdateGoalRequest): ServiceResult<unknown> {
    await this.requireGoal(id);

    if (input.requirement) {
      await this.goalService.updateRequirement(id, input.requirement);
    }

    if (input.budget) {
      await this.goalService.setBudget(id, input.budget);
      // Raising a budget is how a user un-sticks a goal that stopped on one.
      await scheduleGoalAdvance({
        goalId: id,
        trigger: 'budget',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    }

    return this.goalService.graph(id);
  }

  async deleteGoal(id: string): ServiceResult<void> {
    const goal = await this.requireGoal(id);
    // Same rule as `restart`: visibility is not manageability, so only the
    // goal's creator (or a workspace owner) may cascade its graph away.
    await this.assertRowManageable(goal.userId, 'AGENT_UPDATE', 'goal');
    await this.goalService.delete(id);
  }
}
