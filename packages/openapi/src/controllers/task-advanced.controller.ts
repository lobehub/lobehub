import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TaskAdvancedRestService } from '../services/task-advanced.service';
import type { TaskIdParam } from '../types/task.type';
import type {
  AddTaskCommentRequest,
  AddTaskDependencyRequest,
  CreateSubtaskRequest,
  PinTaskDocumentRequest,
  ReorderSubtasksRequest,
  TaskCommentParam,
  TaskDependencyParam,
  TaskDocumentParam,
  TaskSubtaskListQuery,
  UpdateTaskCheckpointRequest,
  UpdateTaskCommentRequest,
  UpdateTaskReviewRequest,
  UpdateTaskVerifyRequest,
} from '../types/task-advanced.type';

/**
 * Task sub-resources controller — subtasks, dependencies, comments, pinned
 * documents, checkpoint / review / verify configuration and archive.
 */
export class TaskAdvancedController extends BaseController {
  private async service(c: Context): Promise<TaskAdvancedRestService> {
    return new TaskAdvancedRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** Run `handler` with the path's task id and answer with its result. */
  private async respond<T>(
    c: Context,
    handler: (service: TaskAdvancedRestService, id: string) => Promise<T>,
    message: string,
    status?: 201,
  ): Promise<Response> {
    try {
      const { id } = this.getParams<TaskIdParam>(c);
      return this.success(c, await handler(await this.service(c), id), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  listSubtasks = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.listSubtasks(id, this.getQuery<TaskSubtaskListQuery>(c).recursive),
      'Subtasks retrieved successfully',
    );

  createSubtask = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.createSubtask(id, await this.getBody<CreateSubtaskRequest>(c)),
      'Subtask created',
      201,
    );

  reorderSubtasks = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.reorderSubtasks(id, (await this.getBody<ReorderSubtasksRequest>(c)).order),
      'Subtasks reordered',
    );

  listDependencies = (c: Context) =>
    this.respond(c, (s, id) => s.listDependencies(id), 'Dependencies retrieved successfully');

  addDependency = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.addDependency(id, await this.getBody<AddTaskDependencyRequest>(c)),
      'Dependency added',
      201,
    );

  removeDependency = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.removeDependency(id, this.getParams<TaskDependencyParam>(c).dependsOnId),
      'Dependency removed',
    );

  listComments = (c: Context) =>
    this.respond(c, (s, id) => s.listComments(id), 'Comments retrieved successfully');

  addComment = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.addComment(id, await this.getBody<AddTaskCommentRequest>(c)),
      'Comment added',
      201,
    );

  updateComment = (c: Context) =>
    this.respond(
      c,
      async (s, id) =>
        s.updateComment(
          id,
          this.getParams<TaskCommentParam>(c).commentId,
          await this.getBody<UpdateTaskCommentRequest>(c),
        ),
      'Comment updated',
    );

  deleteComment = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.deleteComment(id, this.getParams<TaskCommentParam>(c).commentId),
      'Comment deleted',
    );

  listDocuments = (c: Context) =>
    this.respond(c, (s, id) => s.listDocuments(id), 'Pinned documents retrieved successfully');

  pinDocument = (c: Context) =>
    this.respond(
      c,
      async (s, id) =>
        s.pinDocument(id, (await this.getBody<PinTaskDocumentRequest>(c)).documentId),
      'Document pinned',
      201,
    );

  unpinDocument = (c: Context) =>
    this.respond(
      c,
      (s, id) => s.unpinDocument(id, this.getParams<TaskDocumentParam>(c).documentId),
      'Document unpinned',
    );

  getCheckpoint = (c: Context) =>
    this.respond(c, (s, id) => s.getCheckpoint(id), 'Checkpoint retrieved successfully');

  updateCheckpoint = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.updateCheckpoint(id, await this.getBody<UpdateTaskCheckpointRequest>(c)),
      'Checkpoint updated',
    );

  getReview = (c: Context) =>
    this.respond(c, (s, id) => s.getReview(id), 'Review config retrieved successfully');

  updateReview = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.updateReview(id, await this.getBody<UpdateTaskReviewRequest>(c)),
      'Review config updated',
    );

  getVerify = (c: Context) =>
    this.respond(c, (s, id) => s.getVerify(id), 'Verify config retrieved successfully');

  updateVerify = (c: Context) =>
    this.respond(
      c,
      async (s, id) => s.updateVerify(id, await this.getBody<UpdateTaskVerifyRequest>(c)),
      'Verify config updated',
    );

  archive = (c: Context) => this.respond(c, (s, id) => s.setArchived(id, true), 'Task archived');

  unarchive = (c: Context) =>
    this.respond(c, (s, id) => s.setArchived(id, false), 'Task restored from archive');
}
