import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  AddDashboardItemRequestSchema,
  CreateDashboardRequestSchema,
  DashboardDetailSchema,
  DashboardIdParamSchema,
  DashboardItemParamSchema,
  DashboardItemSchema,
  DashboardLayoutResultSchema,
  DashboardListQuerySchema,
  DashboardListResponseSchema,
  DashboardSchema,
  UpdateDashboardLayoutRequestSchema,
  UpdateDashboardRequestSchema,
} from '../types/dashboard.type';

/**
 * Dashboard routes.
 *
 * A dashboard lays widgets out on a grid; one widget can sit on several
 * boards. Boards only arrange widgets — creating, running and publishing them
 * is `/widgets`. Behind the same `dashboard` feature flag (403 while off) and,
 * for writes, the workspace member role. Only a board's creator may change it.
 */
const DashboardRoutes = new Hono();

const TAGS = ['dashboards'];

const dashboardRead = requireApiKeyScope('dashboard:read');
const dashboardWrite = requireApiKeyScope('dashboard:write');

const FLAG_NOTE = 'Answers 403 while dashboards are not enabled for the caller.';

const controller = () => new DashboardController();

DashboardRoutes.get(
  '/',
  routeDoc({
    data: DashboardListResponseSchema,
    description: `Boards living directly on one level — the caller's personal space or workspace by default, or one project or agent. ${FLAG_NOTE}`,
    summary: 'List dashboards',
    tags: TAGS,
  }),
  requireAuth,
  dashboardRead,
  zValidator('query', DashboardListQuerySchema),
  async (c) => controller().listDashboards(c),
);

DashboardRoutes.post(
  '/',
  routeDoc({
    data: DashboardSchema,
    description: `Creates a board. With \`widgetId\` the widget is placed on it in the same transaction, so no empty board is left when it cannot be. ${FLAG_NOTE}`,
    errors: [400, 404],
    status: 201,
    summary: 'Create a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('json', CreateDashboardRequestSchema),
  async (c) => controller().createDashboard(c),
);

DashboardRoutes.get(
  '/:id',
  routeDoc({
    data: DashboardDetailSchema,
    description: `The board with the widgets on it the caller may read, in display order. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Get a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardRead,
  zValidator('param', DashboardIdParamSchema),
  async (c) => controller().getDashboard(c),
);

DashboardRoutes.patch(
  '/:id',
  routeDoc({
    data: DashboardSchema,
    description: `Updates the title, description, icon, order, metadata or visibility. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Update a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('param', DashboardIdParamSchema),
  zValidator('json', UpdateDashboardRequestSchema),
  async (c) => controller().updateDashboard(c),
);

DashboardRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Deletes the board. The widgets on it stay. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Delete a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('param', DashboardIdParamSchema),
  async (c) => controller().deleteDashboard(c),
);

DashboardRoutes.post(
  '/:id/items',
  routeDoc({
    data: DashboardItemSchema,
    description: `Places a widget on the board, or moves it when it is already there. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'dashboards.addItem',
    status: 201,
    summary: 'Place a widget on a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('param', DashboardIdParamSchema),
  zValidator('json', AddDashboardItemRequestSchema),
  async (c) => controller().addItem(c),
);

DashboardRoutes.delete(
  '/:id/items/:itemId',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Takes one placement off the board; the widget itself stays. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'dashboards.removeItem',
    summary: 'Remove a widget from a dashboard',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('param', DashboardItemParamSchema),
  async (c) => controller().removeItem(c),
);

DashboardRoutes.put(
  '/:id/layout',
  routeDoc({
    data: DashboardLayoutResultSchema,
    description: `Saves grid positions and order for items on the board; ids not on it are ignored, and 404 when nothing could be saved. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'dashboards.updateLayout',
    summary: 'Save the dashboard layout',
    tags: TAGS,
  }),
  requireAuth,
  dashboardWrite,
  zValidator('param', DashboardIdParamSchema),
  zValidator('json', UpdateDashboardLayoutRequestSchema),
  async (c) => controller().updateLayout(c),
);

export default DashboardRoutes;
