import type { TaskItem } from '@lobechat/types';

import { DocumentModel } from '@/database/models/document';
import { TaskModel } from '@/database/models/task';
import type { TaskCommentItem, TaskDependencyItem, TaskDocumentItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { taskRouter } from '@/server/routers/lambda/task';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type { DeletedResource } from '../types/common.type';
import type {
  AddTaskCommentRequest,
  AddTaskDependencyRequest,
  CreateSubtaskRequest,
  SubtaskOrder,
  TaskCheckpoint,
  TaskCheckpointConfig,
  TaskReviewConfig,
  TaskVerify,
  UpdateTaskCheckpointRequest,
  UpdateTaskCommentRequest,
  UpdateTaskReviewRequest,
  UpdateTaskVerifyRequest,
} from '../types/task-advanced.type';
import { TaskRestService } from './task.service';

type TaskDependencyView = TaskDependencyItem & { dependsOnIdentifier: string | null };

/**
 * REST service for a task's sub-resources: subtasks, dependencies, comments,
 * pinned documents, checkpoint / review / verify configuration and archive.
 *
 * Every write runs through the `task` tRPC procedures the task page and
 * `lh task` call — invoked server-side with no API-key scopes in their context,
 * since the REST route has already narrowed the key to `agent:*`. That keeps
 * one implementation of the rules that matter: identifier resolution, the
 * one-project dependency boundary, the open-goal archive guard, @mention
 * validation and comment notifications. This layer adds the checks a URL makes
 * necessary — the comment or document must belong to the task in the path —
 * and shapes responses.
 */
export class TaskAdvancedRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };
  private readonly taskModel: TaskModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
    this.taskModel = new TaskModel(db, this.userId, workspaceId);
  }

  private get tasks() {
    return taskRouter.createCaller(this.ctx);
  }

  /** The task as the caller may see it, by id or identifier; 404 otherwise. */
  private async requireTask(id: string): Promise<TaskItem> {
    const task = await this.taskModel.resolve(id);
    if (!task) throw this.createNotFoundError('Task not found');
    return task;
  }

  // ==================== Subtasks ====================

  async listSubtasks(id: string, recursive: boolean): ServiceResult<TaskItem[]> {
    const task = await this.requireTask(id);
    return recursive
      ? this.taskModel.findAllDescendants(task.id)
      : this.taskModel.findSubtasks(task.id);
  }

  async createSubtask(id: string, input: CreateSubtaskRequest): ServiceResult<TaskItem> {
    const parent = await this.requireTask(id);
    // The same create path as `POST /tasks`, so schedule validation, config
    // normalisation and assignment notifications apply to subtasks too.
    return new TaskRestService(this.db, this.userId, this.workspaceId).createTask({
      ...input,
      parentTaskId: parent.id,
    });
  }

  async reorderSubtasks(id: string, order: string[]): ServiceResult<SubtaskOrder[]> {
    const { data } = await this.tasks.reorderSubtasks({ id, order });
    return data;
  }

  // ==================== Dependencies ====================

  async listDependencies(id: string): ServiceResult<TaskDependencyView[]> {
    const { data } = await this.tasks.getDependencies({ id });
    return data.map((dep) => ({ ...dep, dependsOnIdentifier: dep.dependsOnIdentifier ?? null }));
  }

  async addDependency(
    id: string,
    input: AddTaskDependencyRequest,
  ): ServiceResult<TaskDependencyView> {
    const task = await this.requireTask(id);
    const upstream = await this.requireTask(input.dependsOnId);
    if (upstream.id === task.id) {
      throw this.createValidationError('A task cannot depend on itself');
    }
    await this.tasks.addDependency({
      dependsOnId: upstream.id,
      taskId: task.id,
      type: input.type,
    });
    const created = (await this.listDependencies(task.id)).find(
      (dep) => dep.dependsOnId === upstream.id,
    );
    if (!created) throw this.createNotFoundError('Dependency not found');
    return created;
  }

  async removeDependency(id: string, dependsOnId: string): ServiceResult<DeletedResource> {
    const task = await this.requireTask(id);
    const upstream = await this.requireTask(dependsOnId);
    const existing = (await this.listDependencies(task.id)).find(
      (dep) => dep.dependsOnId === upstream.id,
    );
    if (!existing) throw this.createNotFoundError('Dependency not found');
    await this.tasks.removeDependency({ dependsOnId: upstream.id, taskId: task.id });
    return { deleted: true, id: existing.id };
  }

  // ==================== Comments ====================

  async listComments(id: string): ServiceResult<TaskCommentItem[]> {
    const task = await this.requireTask(id);
    return this.taskModel.getComments(task.id);
  }

  async addComment(id: string, input: AddTaskCommentRequest): ServiceResult<TaskCommentItem> {
    const { data } = await this.tasks.addComment({ ...input, id });
    return data;
  }

  /**
   * The comment under the task in the path, and only when the caller may change
   * it: its author, or a member holding workspace-wide `agent:update`. Visibility
   * alone is not enough — every member sees a public task's comments.
   */
  private async requireOwnComment(id: string, commentId: string) {
    const task = await this.requireTask(id);
    const comment = await this.taskModel.findCommentById(commentId);
    if (!comment || comment.taskId !== task.id) {
      throw this.createNotFoundError('Comment not found');
    }
    await this.assertRowManageable(comment.userId, 'AGENT_UPDATE', 'comment');
    return comment;
  }

  async updateComment(
    id: string,
    commentId: string,
    input: UpdateTaskCommentRequest,
  ): ServiceResult<TaskCommentItem> {
    await this.requireOwnComment(id, commentId);
    const { data } = await this.tasks.updateComment({ ...input, commentId });
    return data;
  }

  async deleteComment(id: string, commentId: string): ServiceResult<DeletedResource> {
    await this.requireOwnComment(id, commentId);
    await this.tasks.deleteComment({ commentId });
    return { deleted: true, id: commentId };
  }

  // ==================== Pinned documents ====================

  async listDocuments(id: string): ServiceResult<TaskDocumentItem[]> {
    const { data } = await this.tasks.getPinnedDocuments({ id });
    return data;
  }

  async pinDocument(id: string, documentId: string): ServiceResult<TaskDocumentItem> {
    const task = await this.requireTask(id);
    // A pin only stores the id; check the caller can read the document so a
    // task cannot be made to reference another member's private page.
    const document = await new DocumentModel(this.db, this.userId, this.workspaceId).findById(
      documentId,
    );
    if (!document) throw this.createNotFoundError('Document not found');
    await this.tasks.pinDocument({ documentId, pinnedBy: 'user', taskId: task.id });
    const pinned = (await this.listDocuments(task.id)).find((doc) => doc.documentId === documentId);
    if (!pinned) throw this.createNotFoundError('Document not found');
    return pinned;
  }

  async unpinDocument(id: string, documentId: string): ServiceResult<DeletedResource> {
    const task = await this.requireTask(id);
    const pinned = (await this.listDocuments(task.id)).find((doc) => doc.documentId === documentId);
    if (!pinned) throw this.createNotFoundError('Pinned document not found');
    await this.tasks.unpinDocument({ documentId, taskId: task.id });
    return { deleted: true, id: documentId };
  }

  // ==================== Checkpoint / review / verify ====================

  async getCheckpoint(id: string): ServiceResult<TaskCheckpoint> {
    const { data } = await this.tasks.getCheckpoint({ id });
    return data;
  }

  async updateCheckpoint(
    id: string,
    checkpoint: UpdateTaskCheckpointRequest,
  ): ServiceResult<TaskCheckpointConfig> {
    const { data } = await this.tasks.updateCheckpoint({ checkpoint, id });
    return data;
  }

  async getReview(id: string): ServiceResult<TaskReviewConfig | null> {
    const { data } = await this.tasks.getReview({ id });
    return (data as TaskReviewConfig | null) ?? null;
  }

  async updateReview(id: string, review: UpdateTaskReviewRequest): ServiceResult<TaskReviewConfig> {
    const { data } = await this.tasks.updateReview({ id, review });
    return data as TaskReviewConfig;
  }

  async getVerify(id: string): ServiceResult<TaskVerify | null> {
    const { data } = await this.tasks.getVerifyConfig({ id });
    return data;
  }

  async updateVerify(id: string, verify: UpdateTaskVerifyRequest): ServiceResult<TaskVerify> {
    const { data } = await this.tasks.updateVerifyConfig({ id, verify });
    return data;
  }

  // ==================== Archive ====================

  /**
   * Archive takes the task out of every list without touching its status; a
   * task still running, scheduled or inside an open goal is refused.
   */
  async setArchived(id: string, archived: boolean): ServiceResult<TaskItem> {
    const { data } = await this.tasks.archive({ archived, id });
    return data;
  }
}
