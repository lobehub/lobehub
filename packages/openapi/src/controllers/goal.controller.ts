import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { GoalRestService } from '../services/goal.service';
import type {
  CreateGoalRequest,
  GoalIdParam,
  GoalListQuery,
  RestartGoalRequest,
  UpdateGoalRequest,
} from '../types/goal.type';

/**
 * Goals controller.
 * Handles HTTP concerns only — the coordinator behaviour lives in `GoalService`.
 */
export class GoalController extends BaseController {
  private async service(c: Context): Promise<GoalRestService> {
    return new GoalRestService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  /** GET /api/v1/goals */
  async listGoals(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<GoalListQuery>(c);
      const service = await this.service(c);
      return this.success(c, await service.listGoals(query), 'Goal list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/goals */
  async createGoal(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateGoalRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createGoal(body), 'Goal created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/goals/:id */
  async getGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getGoal(id), 'Goal retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/goals/:id/supervision */
  async getGoalSupervision(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getSupervision(id), 'Goal supervision retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/goals/:id */
  async updateGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const body = await this.getBody<UpdateGoalRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateGoal(id, body), 'Goal updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/goals/:id */
  async deleteGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      await service.deleteGoal(id);
      return this.success(c, undefined, 'Goal deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/goals/:id/advance */
  async advanceGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.advanceGoal(id), 'Goal advanced');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/goals/:id/pause */
  async pauseGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.pauseGoal(id), 'Goal paused');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/goals/:id/resume */
  async resumeGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.resumeGoal(id), 'Goal resumed');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/goals/:id/restart */
  async restartGoal(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<GoalIdParam>(c);
      const body = await this.getBody<RestartGoalRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.restartGoal(id, body), 'Goal restarted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
