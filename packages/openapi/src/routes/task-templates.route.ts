import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TaskTemplateController } from '../controllers/task-template.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { TaskTemplateListQuerySchema, TaskTemplateSchema } from '../types/task-template.type';

/**
 * Task template routes — the recurring tasks the "new task" page recommends.
 * Reading them is part of viewing tasks, so the gate is `agent:read`.
 */
const TaskTemplateRoutes = new Hono();

/** GET /api/v1/task-templates */
TaskTemplateRoutes.get(
  '/',
  routeDoc({
    data: z.array(TaskTemplateSchema),
    description:
      "Today's recommended recurring tasks for the given interests. The set rotates daily; pass a new `refreshSeed` for another draw. Create one with `POST /api/v1/tasks`.",
    summary: 'List recommended task templates',
    tags: ['task-templates'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_READ'),
    'You do not have permission to view task templates',
  ),
  zValidator('query', TaskTemplateListQuerySchema),
  async (c) => new TaskTemplateController().listTemplates(c),
);

export default TaskTemplateRoutes;
