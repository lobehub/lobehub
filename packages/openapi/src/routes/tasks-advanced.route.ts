import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TaskAdvancedController } from '../controllers/task-advanced.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import { TaskIdParamSchema, TaskSchema } from '../types/task.type';
import {
  AddTaskCommentRequestSchema,
  AddTaskDependencyRequestSchema,
  CreateSubtaskRequestSchema,
  PinTaskDocumentRequestSchema,
  ReorderSubtasksRequestSchema,
  SubtaskOrderSchema,
  TaskCheckpointConfigSchema,
  TaskCheckpointSchema,
  TaskCommentParamSchema,
  TaskCommentSchema,
  TaskDependencyParamSchema,
  TaskDependencySchema,
  TaskDocumentParamSchema,
  TaskPinnedDocumentSchema,
  TaskReviewConfigSchema,
  TaskSubtaskListQuerySchema,
  TaskVerifySchema,
  UpdateTaskCheckpointRequestSchema,
  UpdateTaskCommentRequestSchema,
  UpdateTaskReviewRequestSchema,
  UpdateTaskVerifyRequestSchema,
} from '../types/task-advanced.type';

/**
 * Task sub-resource routes, mounted under `/api/v1/tasks`: the subtask tree,
 * dependencies, comments, pinned documents, checkpoint / review / verify
 * configuration and archive.
 *
 * Same `agent:read` / `agent:update` gate as the task routes themselves — the
 * in-app task surface applies one permission to a task and everything on it.
 * Every `{id}` accepts the task id or its identifier (`T-12`).
 */
const TaskAdvancedRoutes = new Hono();

const taskRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  'You do not have permission to view tasks',
);
const taskWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to manage tasks',
);

const controller = () => new TaskAdvancedController();
const tags = ['tasks'];

// ==================== Subtasks ====================

TaskAdvancedRoutes.get(
  '/:id/subtasks',
  routeDoc({
    data: z.array(TaskSchema),
    description: 'Direct subtasks in display order, or every descendant with `recursive=true`.',
    errors: [404],
    summary: 'List subtasks of a task',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  zValidator('query', TaskSubtaskListQuerySchema),
  (c) => controller().listSubtasks(c),
);

TaskAdvancedRoutes.post(
  '/:id/subtasks',
  routeDoc({
    data: TaskSchema,
    // 404: the parent task or the assignee agent does not exist; 412: a precise
    // schedule the plan does not allow.
    errors: [404, 412],
    operationId: 'tasks.createSubtask',
    status: 201,
    summary: 'Create a subtask',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', CreateSubtaskRequestSchema),
  (c) => controller().createSubtask(c),
);

TaskAdvancedRoutes.put(
  '/:id/subtasks/order',
  routeDoc({
    data: z.array(SubtaskOrderSchema),
    description: 'Sets the display order of direct subtasks; every listed task must be one.',
    errors: [404],
    operationId: 'tasks.reorderSubtasks',
    summary: 'Reorder subtasks',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', ReorderSubtasksRequestSchema),
  (c) => controller().reorderSubtasks(c),
);

// ==================== Dependencies ====================

TaskAdvancedRoutes.get(
  '/:id/dependencies',
  routeDoc({
    data: z.array(TaskDependencySchema),
    errors: [404],
    summary: 'List the tasks a task depends on',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().listDependencies(c),
);

TaskAdvancedRoutes.post(
  '/:id/dependencies',
  routeDoc({
    data: TaskDependencySchema,
    description:
      'A `blocks` dependency keeps the task in backlog until the upstream task completes. Both tasks must be in the same project.',
    errors: [404],
    operationId: 'tasks.addDependency',
    status: 201,
    summary: 'Add a dependency',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', AddTaskDependencyRequestSchema),
  (c) => controller().addDependency(c),
);

TaskAdvancedRoutes.delete(
  '/:id/dependencies/:dependsOnId',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    operationId: 'tasks.removeDependency',
    summary: 'Remove a dependency',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskDependencyParamSchema),
  (c) => controller().removeDependency(c),
);

// ==================== Comments ====================

TaskAdvancedRoutes.get(
  '/:id/comments',
  routeDoc({
    data: z.array(TaskCommentSchema),
    description: 'Every comment on the task, oldest first.',
    errors: [404],
    summary: 'List comments on a task',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().listComments(c),
);

TaskAdvancedRoutes.post(
  '/:id/comments',
  routeDoc({
    data: TaskCommentSchema,
    description:
      "Notifies the task's creator and assignee, and every member the comment @mentions.",
    errors: [404],
    operationId: 'tasks.addComment',
    status: 201,
    summary: 'Comment on a task',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', AddTaskCommentRequestSchema),
  (c) => controller().addComment(c),
);

TaskAdvancedRoutes.patch(
  '/:id/comments/:commentId',
  routeDoc({
    data: TaskCommentSchema,
    description: 'Only the comment author or a workspace owner may edit it.',
    errors: [404],
    operationId: 'tasks.updateComment',
    summary: 'Edit a comment',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskCommentParamSchema),
  zValidator('json', UpdateTaskCommentRequestSchema),
  (c) => controller().updateComment(c),
);

TaskAdvancedRoutes.delete(
  '/:id/comments/:commentId',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Only the comment author or a workspace owner may delete it.',
    errors: [404],
    operationId: 'tasks.deleteComment',
    summary: 'Delete a comment',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskCommentParamSchema),
  (c) => controller().deleteComment(c),
);

// ==================== Pinned documents ====================

TaskAdvancedRoutes.get(
  '/:id/documents',
  routeDoc({
    data: z.array(TaskPinnedDocumentSchema),
    errors: [404],
    summary: 'List documents pinned to a task',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().listDocuments(c),
);

TaskAdvancedRoutes.post(
  '/:id/documents',
  routeDoc({
    data: TaskPinnedDocumentSchema,
    description: 'Pinned documents are read by every run of the task. Pinning twice is a no-op.',
    errors: [404],
    operationId: 'tasks.pinDocument',
    status: 201,
    summary: 'Pin a document to a task',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', PinTaskDocumentRequestSchema),
  (c) => controller().pinDocument(c),
);

TaskAdvancedRoutes.delete(
  '/:id/documents/:documentId',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    operationId: 'tasks.unpinDocument',
    summary: 'Unpin a document from a task',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskDocumentParamSchema),
  (c) => controller().unpinDocument(c),
);

// ==================== Checkpoint / review / verify ====================

TaskAdvancedRoutes.get(
  '/:id/checkpoints',
  routeDoc({
    data: TaskCheckpointSchema,
    description: 'Where the task pauses for a person, with each referenced subtask resolved.',
    errors: [404],
    operationId: 'tasks.getCheckpoint',
    summary: 'Get the checkpoint configuration',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().getCheckpoint(c),
);

TaskAdvancedRoutes.put(
  '/:id/checkpoints',
  routeDoc({
    data: TaskCheckpointConfigSchema,
    errors: [404],
    operationId: 'tasks.updateCheckpoint',
    summary: 'Replace the checkpoint configuration',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskCheckpointRequestSchema),
  (c) => controller().updateCheckpoint(c),
);

TaskAdvancedRoutes.get(
  '/:id/review',
  routeDoc({
    data: TaskReviewConfigSchema.nullable(),
    description: '`null` when the task has no review configured.',
    errors: [404],
    summary: 'Get the review configuration',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().getReview(c),
);

TaskAdvancedRoutes.put(
  '/:id/review',
  routeDoc({
    data: TaskReviewConfigSchema,
    errors: [404],
    summary: 'Replace the review configuration',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskReviewRequestSchema),
  (c) => controller().updateReview(c),
);

TaskAdvancedRoutes.get(
  '/:id/verify',
  routeDoc({
    data: TaskVerifySchema.nullable(),
    description:
      'The acceptance check each delivery is verified against; `null` when none applies.',
    errors: [404],
    operationId: 'tasks.getVerifyConfig',
    summary: 'Get the verify configuration',
    tags,
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().getVerify(c),
);

TaskAdvancedRoutes.patch(
  '/:id/verify',
  routeDoc({
    data: TaskVerifySchema,
    description: '`null` clears a field; an omitted field keeps its value.',
    errors: [404],
    operationId: 'tasks.updateVerifyConfig',
    summary: 'Update the verify configuration',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskVerifyRequestSchema),
  (c) => controller().updateVerify(c),
);

// ==================== Archive ====================

TaskAdvancedRoutes.post(
  '/:id/archive',
  routeDoc({
    data: TaskSchema,
    description:
      'Takes the task out of every list without changing its status. A running or scheduled task, or one inside an open goal, is refused.',
    errors: [404],
    operationId: 'tasks.archive',
    summary: 'Archive a task',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().archive(c),
);

TaskAdvancedRoutes.post(
  '/:id/unarchive',
  routeDoc({
    data: TaskSchema,
    errors: [404],
    operationId: 'tasks.unarchive',
    summary: 'Restore an archived task',
    tags,
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  (c) => controller().unarchive(c),
);

export default TaskAdvancedRoutes;
