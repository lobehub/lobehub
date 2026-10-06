import { AgentModel } from '@/database/models/agent';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { EditLockService } from '@/server/services/editLock';
import { TaskService } from '@/server/services/task';
import { notifyAssignedBestEffort } from '@/server/services/task/assignmentNotification';
import { resolveTaskPatchInvariants } from '@/server/services/task/patchValidation';
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
    const task = await this.taskService.createTask(input);
    // Creating a task already assigned to another member notifies them, the way
    // the tRPC create boundary does; self-assignment is filtered inside the
    // helper, so this stays silent for the caller's own task.
    notifyAssignedBestEffort({ userId: this.userId, workspaceId: this.workspaceId }, task);
    return task;
  }

  async updateTask(id: string, input: UpdateTaskRequest): ServiceResult<unknown> {
    // Hierarchy, visibility, assignment and schedule invariants all live in one
    // shared place, so this patch cannot persist what the in-app editor refuses
    // — a task parented to itself, a public child under a private parent, an
    // unusable or private assignee — and the two boundaries cannot drift.
    const { data, resolved } = await resolveTaskPatchInvariants(
      {
        agentModel: new AgentModel(this.db, this.userId, this.workspaceId),
        editLockService: new EditLockService(this.userId),
        serverDB: this.db,
        taskModel: this.taskModel,
        taskService: this.taskService,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      { data: input, id, parentTaskId: input.parentTaskId },
    );

    // The patch is a partial row update; the model owns which columns are
    // accepted and normalises the null-vs-undefined distinction itself.
    const updated = await this.taskService.updateTaskWithAssigneeLock(
      resolved.id,
      data as Parameters<TaskModel['update']>[1],
      { userId: this.userId },
    );
    if (!updated) throw this.createNotFoundError('Task not found');
    // Only an actual assignee change notifies — re-saving the same assignee
    // stays silent, exactly like the tRPC patch boundary. `resolved` is the row
    // as it was before this patch, so the comparison cannot be fooled by a
    // partial update that leaves the assignee untouched.
    if (updated.assigneeUserId !== resolved.assigneeUserId) {
      notifyAssignedBestEffort({ userId: this.userId, workspaceId: this.workspaceId }, updated);
    }
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
