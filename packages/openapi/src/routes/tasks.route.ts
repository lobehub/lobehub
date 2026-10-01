import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { TaskController } from '../controllers/task.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateTaskRequestSchema,
  TaskIdParamSchema,
  TaskListQuerySchema,
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
TaskRoutes.get('/', requireAuth, taskRead, zValidator('query', TaskListQuerySchema), async (c) =>
  new TaskController().listTasks(c),
);

/** POST /api/v1/tasks */
TaskRoutes.post(
  '/',
  requireAuth,
  taskWrite,
  zValidator('json', CreateTaskRequestSchema),
  async (c) => new TaskController().createTask(c),
);

/** GET /api/v1/tasks/:id */
TaskRoutes.get('/:id', requireAuth, taskRead, zValidator('param', TaskIdParamSchema), async (c) =>
  new TaskController().getTask(c),
);

/** PATCH /api/v1/tasks/:id */
TaskRoutes.patch(
  '/:id',
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskRequestSchema),
  async (c) => new TaskController().updateTask(c),
);

/** PATCH /api/v1/tasks/:id/status */
TaskRoutes.patch(
  '/:id/status',
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  zValidator('json', UpdateTaskStatusRequestSchema),
  async (c) => new TaskController().updateTaskStatus(c),
);

/** DELETE /api/v1/tasks/:id */
TaskRoutes.delete(
  '/:id',
  requireAuth,
  taskWrite,
  zValidator('param', TaskIdParamSchema),
  async (c) => new TaskController().deleteTask(c),
);

export default TaskRoutes;
