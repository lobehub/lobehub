import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { GoalController } from '../controllers/goal.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateGoalRequestSchema,
  GoalIdParamSchema,
  GoalListQuerySchema,
  RestartGoalRequestSchema,
  UpdateGoalRequestSchema,
} from '../types/goal.type';

/**
 * Goal routes.
 *
 * Goals are long-horizon, self-advancing targets: creating one hands it to the
 * coordinator, and the client reads progress instead of driving each step.
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
GoalRoutes.get('/', requireAuth, goalRead, zValidator('query', GoalListQuerySchema), async (c) =>
  new GoalController().listGoals(c),
);

/** POST /api/v1/goals — create a goal and start its coordinator. */
GoalRoutes.post(
  '/',
  requireAuth,
  goalWrite,
  zValidator('json', CreateGoalRequestSchema),
  async (c) => new GoalController().createGoal(c),
);

/** GET /api/v1/goals/:id — the goal and its whole graph. */
GoalRoutes.get('/:id', requireAuth, goalRead, zValidator('param', GoalIdParamSchema), async (c) =>
  new GoalController().getGoal(c),
);

/** GET /api/v1/goals/:id/supervision — supervision toggle and current state. */
GoalRoutes.get(
  '/:id/supervision',
  requireAuth,
  goalRead,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().getGoalSupervision(c),
);

/** PATCH /api/v1/goals/:id — update the acceptance requirement and/or budget. */
GoalRoutes.patch(
  '/:id',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', UpdateGoalRequestSchema),
  async (c) => new GoalController().updateGoal(c),
);

/** DELETE /api/v1/goals/:id — stop the goal and cascade its graph. */
GoalRoutes.delete(
  '/:id',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().deleteGoal(c),
);

/** POST /api/v1/goals/:id/advance — run the coordinator now. */
GoalRoutes.post(
  '/:id/advance',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().advanceGoal(c),
);

/** POST /api/v1/goals/:id/pause */
GoalRoutes.post(
  '/:id/pause',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().pauseGoal(c),
);

/** POST /api/v1/goals/:id/resume */
GoalRoutes.post(
  '/:id/resume',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  async (c) => new GoalController().resumeGoal(c),
);

/** POST /api/v1/goals/:id/restart — start every unfinished task node over. */
GoalRoutes.post(
  '/:id/restart',
  requireAuth,
  goalWrite,
  zValidator('param', GoalIdParamSchema),
  zValidator('json', RestartGoalRequestSchema),
  async (c) => new GoalController().restartGoal(c),
);

export default GoalRoutes;
