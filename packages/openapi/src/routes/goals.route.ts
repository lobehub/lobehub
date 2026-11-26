import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GoalController } from '../controllers/goal.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateGoalRequestSchema,
  GoalAdvanceResultSchema,
  GoalGraphSchema,
  GoalGraphSnapshotSchema,
  GoalIdParamSchema,
  GoalListQuerySchema,
  GoalListResponseSchema,
  GoalRestartResultSchema,
  GoalSchema,
  GoalSupervisionSchema,
  RestartGoalRequestSchema,
  UpdateGoalRequestSchema,
} from '../types/goal.type';

/**
 * Goal routes.
 *
 * Goals are long-horizon, self-advancing targets: creating one hands it to the
 * coordinator, and the client reads progress instead of driving each step.
 * Sub-actions carry explicit operation ids so generated SDK methods read as
 * `goals.advanceGoal()` rather than a positional `createAdvance()`.
 */
const GoalRoutes = new Hono();

const goalRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  'You do not have permission to view goals',
);
const goalWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to manage goals',
);

/** GET /api/v1/goals — list goals with their graph roll-up. */
GoalRoutes.get(
  '/',
  routeDoc({ data: GoalListResponseSchema, summary: 'List goals', tags: ['goals'] }),
  requireAuth,
  goalRead,
  zValidator('query', GoalListQuerySchema),
  async (c) => new GoalController().listGoals(c),
);

/** POST /api/v1/goals — create a goal and start its coordinator. */
GoalRoutes.post(
  '/',
  routeDoc({
    data: GoalGraphSnapshotSchema,
    description: 'Creates the goal graph and hands it to the coordinator.',
    // The supervising agent or the project named in the body may not exist.
    errors: [404],
    status: 201,
    summary: 'Create a goal',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('json', CreateGoalRequestSchema),
  async (c) => new GoalController().createGoal(c),
);

/** GET /api/v1/goals/:id — the goal and its whole graph. */
GoalRoutes.get(
  '/:id',
  routeDoc({
    data: GoalGraphSchema,
    errors: [404],
    summary: 'Get a goal and its graph',
    tags: ['goals'],
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().getGoal(c),
);

/** GET /api/v1/goals/:id/supervision — supervision toggle and current state. */
GoalRoutes.get(
  '/:id/supervision',
  routeDoc({
    data: GoalSupervisionSchema,
    errors: [404],
    summary: 'Get goal supervision state',
    tags: ['goals'],
  }),
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().getGoalSupervision(c),
);

/** PATCH /api/v1/goals/:id — update the acceptance requirement and/or budget. */
GoalRoutes.patch(
  '/:id',
  routeDoc({
    data: GoalGraphSchema,
    errors: [404],
    summary: 'Update a goal requirement or budget',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', UpdateGoalRequestSchema),
  async (c) => new GoalController().updateGoal(c),
);

/** DELETE /api/v1/goals/:id — stop the goal and cascade its graph. */
GoalRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    // 409 / 412: a supervised or managed goal whose live turn cannot be fenced off.
    errors: [404, 409, 412],
    summary: 'Delete a goal',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().deleteGoal(c),
);

/** POST /api/v1/goals/:id/advance — run the coordinator now. */
GoalRoutes.post(
  '/:id/advance',
  routeDoc({
    data: GoalAdvanceResultSchema,
    errors: [404],
    operationId: 'goals.advance',
    summary: 'Run the goal coordinator now',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().advanceGoal(c),
);

/** POST /api/v1/goals/:id/pause */
GoalRoutes.post(
  '/:id/pause',
  routeDoc({
    data: GoalSchema,
    // 409: a draft never started; 412: an archived goal stays put.
    errors: [404, 409, 412],
    operationId: 'goals.pause',
    summary: 'Pause a goal',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().pauseGoal(c),
);

/** POST /api/v1/goals/:id/resume */
GoalRoutes.post(
  '/:id/resume',
  routeDoc({
    data: GoalSchema,
    // 409: a draft, or the goal changed while resuming; 412: an archived goal.
    errors: [404, 409, 412],
    operationId: 'goals.resume',
    summary: 'Resume a paused goal',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().resumeGoal(c),
);

/** POST /api/v1/goals/:id/restart — start every unfinished task node over. */
GoalRoutes.post(
  '/:id/restart',
  routeDoc({
    data: GoalRestartResultSchema,
    // 412: an archived goal is not restarted.
    errors: [404, 412],
    operationId: 'goals.restart',
    summary: 'Restart every unfinished task of a goal',
    tags: ['goals'],
  }),
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', RestartGoalRequestSchema),
  async (c) => new GoalController().restartGoal(c),
);

export default GoalRoutes;
