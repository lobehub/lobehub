import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TaskController } from '../controllers/task.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateTaskRequestSchema,
  RunTaskRequestSchema,
  TaskDetailSchema,
  TaskIdParamSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskRunListQuerySchema,
  TaskRunSchema,
  TaskRunStartedSchema,
  TaskSchema,
  TaskStatusUpdateResultSchema,
  UpdateTaskRequestSchema,
  UpdateTaskStatusRequestSchema,
} from '../types/task.type';

/**
 * Task routes.
 *
 * Tasks reuse the same `agent:read` / `agent:update` gate the in-app task
 * surface applies, and every mutation goes through `TaskService`, so the
 * assignment locks, run interruption and activity feed stay identical.
 */
const TaskRoutes = new Hono();

const taskRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  'You do not have permission to view tasks',
);
const taskWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to manage tasks',
);

/** GET /api/v1/tasks */
TaskRoutes.get(
  '/',
  routeDoc({ data: TaskListResponseSchema, summary: 'List tasks', tags: ['tasks'] }),
  requireAuth,
  taskRead,
  zValidator('query', TaskListQuerySchema),
  async (c) => new TaskController().listTasks(c),
);

/** POST /api/v1/tasks */
TaskRoutes.post(
  '/',
  routeDoc({
    data: TaskSchema,
    // 404: the parent task or assignee agent does not exist; 412: a precise
    // schedule the plan does not allow.
    errors: [404, 412],
    status: 201,
    summary: 'Create a task',
    tags: ['tasks'],
  }),
  requireAuth,
  taskWrite,
  zValidator('json', CreateTaskRequestSchema),
  async (c) => new TaskController().createTask(c),
);

/** GET /api/v1/tasks/:id */
TaskRoutes.get(
  '/:id',
  routeDoc({ data: TaskDetailSchema, errors: [404], summary: 'Get a task', tags: ['tasks'] }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  async (c) => new TaskController().getTask(c),
);

/** PATCH /api/v1/tasks/:id */
TaskRoutes.patch(
  '/:id',
  routeDoc({
    data: TaskSchema,
    // 409: the assignee is being changed concurrently; 412: a precise schedule
    // the plan does not allow.
    errors: [404, 409, 412],
    summary: 'Update a task',
    tags: ['tasks'],
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskRequestSchema),
  async (c) => new TaskController().updateTask(c),
);

/** PATCH /api/v1/tasks/:id/status */
TaskRoutes.patch(
  '/:id/status',
  routeDoc({
    data: TaskStatusUpdateResultSchema,
    // 409: the running operation could not be confirmed stopped.
    errors: [404, 409],
    summary: 'Change a task status',
    tags: ['tasks'],
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskStatusRequestSchema),
  async (c) => new TaskController().updateTaskStatus(c),
);

/** POST /api/v1/tasks/:id/runs — start a run now, the API twin of the in-app "Run now". */
TaskRoutes.post(
  '/:id/runs',
  routeDoc({
    data: TaskRunStartedSchema,
    description:
      'Starts the run and answers once the agent operation is accepted; follow it with `operationId`.',
    // 409: the task is already running or changed while starting; 412: an
    // archived task must be restored before it runs.
    errors: [404, 409, 412],
    status: 202,
    summary: 'Run a task now',
    tags: ['tasks'],
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', RunTaskRequestSchema),
  async (c) => new TaskController().runTask(c),
);

/** GET /api/v1/tasks/:id/runs — past runs, newest first, each with its handoff result. */
TaskRoutes.get(
  '/:id/runs',
  routeDoc({
    data: z.array(TaskRunSchema),
    errors: [404],
    summary: 'List past runs of a task',
    tags: ['tasks'],
  }),
  requireAuth,
  taskRead,
  zValidator('param', TaskIdParamSchema),
  zValidator('query', TaskRunListQuerySchema),
  async (c) => new TaskController().listRuns(c),
);

/** DELETE /api/v1/tasks/:id */
TaskRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    // 409: a live run could not be stopped before the delete.
    errors: [404, 409],
    summary: 'Delete a task',
    tags: ['tasks'],
  }),
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  async (c) => new TaskController().deleteTask(c),
);

export default TaskRoutes;
