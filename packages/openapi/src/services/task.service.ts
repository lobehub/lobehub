import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';
import { assertResultingScheduleValid } from '@/server/services/task/scheduleValidation';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  CreateTaskRequest,
  TaskListQuery,
  UpdateTaskRequest,
  UpdateTaskStatusRequest,
} from '../types/task.type';

/**
 * Tasks REST service.
 *
 * The task orchestration already lives in `TaskService` — assignment locks,
 * visibility compatibility, run interruption, activity logging — so this layer
 * only decides who may ask. Nothing is re-implemented here, which is why the
 * in-app task feed and this API cannot drift apart.
 */
export class TaskRestService extends BaseService {
  private readonly taskModel: TaskModel;
  private readonly taskService: TaskService;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId ?? '', workspaceId);
    this.taskService = new TaskService(db, userId ?? '', workspaceId);
  }

  async listTasks(query: TaskListQuery): ServiceResult<unknown> {
    return this.taskModel.list({
      assigneeAgentId: query.assigneeAgentId,
      limit: query.limit,
      offset: query.offset,
      projectId: query.projectId,
      statuses: query.statuses,
    });
  }

  async getTask(id: string): ServiceResult<unknown> {
    const detail = await this.taskService.getTaskDetail(id);
    if (!detail) throw this.createNotFoundError('Task not found');
    return detail;
  }

  async createTask(input: CreateTaskRequest): ServiceResult<unknown> {
    // The request schemas check the cron pattern and the timezone one at a
    // time; this checks the pair the task ends up with, exactly like the tRPC
    // create boundary, so a schedule the dispatcher cannot evaluate is refused
    // here instead of being stored and silently never firing.
    assertResultingScheduleValid(null, input);
    return this.taskService.createTask(input);
  }

  async updateTask(id: string, input: UpdateTaskRequest): ServiceResult<unknown> {
    const task = await this.taskModel.resolve(id);
    if (!task) throw this.createNotFoundError('Task not found');

    // A pattern-only patch keeps the stored timezone, and turning on `schedule`
    // mode re-checks the stored pair, so validate against the row being updated
    // rather than the patch alone.
    assertResultingScheduleValid(task, input);

    // The update body is a partial row patch; the model owns which columns are
    // accepted and normalises the null-vs-undefined distinction itself.
    const data = input as Parameters<TaskModel['update']>[1];
    const updated = await this.taskService.updateTaskWithAssigneeLock(task.id, data, {
      userId: this.userId,
    });
    if (!updated) throw this.createNotFoundError('Task not found');
    return updated;
  }

  async updateTaskStatus(id: string, input: UpdateTaskStatusRequest): ServiceResult<unknown> {
    // A person (or their agent) made this change, so it belongs in the feed —
    // the service treats a missing actor as a system transition.
    return this.taskService.updateStatus(
      { error: input.error, id, status: input.status },
      { userId: this.userId },
    );
  }

  async deleteTask(id: string): ServiceResult<unknown> {
    // `TaskModel` resolves any public task for a workspace, so `agent:update`
    // alone would let a member delete a colleague's task and interrupt its live
    // runs; the tRPC delete path gates this on the row's creator, and this one
    // must not be the way around it.
    const task = await this.taskModel.resolve(id);
    if (!task) throw this.createNotFoundError('Task not found');
    await this.assertRowManageable(task.createdByUserId, 'AGENT_UPDATE', 'task');
    return this.taskService.deleteTask(task.id);
  }
}
