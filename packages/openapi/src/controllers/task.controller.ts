import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TaskRestService } from '../services/task.service';
import type {
  CreateTaskRequest,
  TaskIdParam,
  TaskListQuery,
  UpdateTaskRequest,
  UpdateTaskStatusRequest,
} from '../types/task.type';

/** Tasks controller — list, inspect, create, patch, transition and delete tasks. */
export class TaskController extends BaseController {
  private async service(c: Context): Promise<TaskRestService> {
    return new TaskRestService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  /** GET /api/v1/tasks */
  async listTasks(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<TaskListQuery>(c);
      const service = await this.service(c);
      return this.success(c, await service.listTasks(query), 'Task list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/tasks */
  async createTask(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateTaskRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createTask(body), 'Task created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/tasks/:id */
  async getTask(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<TaskIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getTask(id), 'Task retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/tasks/:id */
  async updateTask(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<TaskIdParam>(c);
      const body = await this.getBody<UpdateTaskRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateTask(id, body), 'Task updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/tasks/:id/status */
  async updateTaskStatus(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<TaskIdParam>(c);
      const body = await this.getBody<UpdateTaskStatusRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateTaskStatus(id, body), 'Task status updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/tasks/:id */
  async deleteTask(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<TaskIdParam>(c);
      const service = await this.service(c);
      await service.deleteTask(id);
      return this.success(c, undefined, 'Task deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
