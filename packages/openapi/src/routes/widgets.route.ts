import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { WidgetController } from '../controllers/widget.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateWidgetRequestSchema,
  DryRunWidgetRequestSchema,
  PublishWidgetRequestSchema,
  RunWidgetRequestSchema,
  SaveWidgetDraftRequestSchema,
  UpdateWidgetRequestSchema,
  UpdateWidgetScheduleRequestSchema,
  WIDGET_CREDENTIAL_RISK,
  WidgetDetailSchema,
  WidgetIdParamSchema,
  WidgetListQuerySchema,
  WidgetListResponseSchema,
  WidgetPublishResultSchema,
  WidgetRunListQuerySchema,
  WidgetRunListResponseSchema,
  WidgetRunParamSchema,
  WidgetRunSchema,
  WidgetSchema,
  WidgetVersionListResponseSchema,
  WidgetVersionParamSchema,
  WidgetVersionSchema,
} from '../types/widget.type';

/**
 * Widget routes.
 *
 * A widget is a script whose JSON output renders as a card. Authoring is a
 * draft → dry run → publish loop; the published version then refreshes on its
 * schedule or on demand. Widgets and dashboards are behind the `dashboard`
 * feature flag — while it is off for the caller every call answers 403.
 *
 * Executing a script spends sandbox time and uses the caller's connector
 * credentials, so the routes that execute or publish one (`dry-run`, `runs`,
 * `publish`, `schedule`) need their own `widget:publish` scope and a
 * `confirm: true` body; authoring stays on `widget:write`. Writes also need
 * the workspace member role, as in the app.
 */
const WidgetRoutes = new Hono();

const TAGS = ['widgets'];

const widgetRead = requireApiKeyScope('widget:read');
const widgetWrite = requireApiKeyScope('widget:write');
const widgetPublish = requireApiKeyScope('widget:publish');

const FLAG_NOTE = 'Answers 403 while dashboards are not enabled for the caller.';

const controller = () => new WidgetController();

// ==================== Widgets ====================

WidgetRoutes.get(
  '/',
  routeDoc({
    data: WidgetListResponseSchema,
    description: `Widgets living directly on one level — the caller's personal space or workspace by default, or one project or agent. ${FLAG_NOTE}`,
    summary: 'List widgets',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('query', WidgetListQuerySchema),
  async (c) => controller().listWidgets(c),
);

WidgetRoutes.post(
  '/',
  routeDoc({
    data: WidgetSchema,
    description: `Creates an empty widget — add its script with a draft. With \`dashboardId\` it is placed on that board in the same transaction. ${FLAG_NOTE}`,
    errors: [400, 404],
    status: 201,
    summary: 'Create a widget',
    tags: TAGS,
  }),
  requireAuth,
  widgetWrite,
  zValidator('json', CreateWidgetRequestSchema),
  async (c) => controller().createWidget(c),
);

WidgetRoutes.get(
  '/:id',
  routeDoc({
    data: WidgetDetailSchema,
    description: `The widget with its published and draft versions and the boards it is on. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Get a widget',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('param', WidgetIdParamSchema),
  async (c) => controller().getWidget(c),
);

WidgetRoutes.patch(
  '/:id',
  routeDoc({
    data: WidgetSchema,
    description: `Updates the title, description, metadata or visibility. Only the creator may edit. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Update a widget',
    tags: TAGS,
  }),
  requireAuth,
  widgetWrite,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', UpdateWidgetRequestSchema),
  async (c) => controller().updateWidget(c),
);

WidgetRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Deletes the widget with its versions and runs, and takes it off every board. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'Delete a widget',
    tags: TAGS,
  }),
  requireAuth,
  widgetWrite,
  zValidator('param', WidgetIdParamSchema),
  async (c) => controller().deleteWidget(c),
);

// ==================== Versions ====================

WidgetRoutes.post(
  '/:id/drafts',
  routeDoc({
    data: WidgetVersionSchema,
    description: `Records a script and its output contract as the widget's draft version. Saving content identical to the current draft returns that draft. Saving does not execute anything. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'widgets.saveDraft',
    status: 201,
    summary: 'Save a widget draft',
    tags: TAGS,
  }),
  requireAuth,
  widgetWrite,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', SaveWidgetDraftRequestSchema),
  async (c) => controller().saveDraft(c),
);

WidgetRoutes.get(
  '/:id/versions',
  routeDoc({
    data: WidgetVersionListResponseSchema,
    description: `Every version of the widget, newest first. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'List widget versions',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('param', WidgetIdParamSchema),
  async (c) => controller().listVersions(c),
);

WidgetRoutes.get(
  '/:id/versions/:versionId',
  routeDoc({
    data: WidgetVersionSchema,
    description: `One version with its script, manifest and view. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'widgets.getVersion',
    summary: 'Get a widget version',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('param', WidgetVersionParamSchema),
  async (c) => controller().getVersion(c),
);

WidgetRoutes.post(
  '/:id/dry-run',
  routeDoc({
    data: WidgetRunSchema,
    description: `Executes one version as a preview without touching the live widget, and returns the finished run. A draft must have a successful dry run before it can be published.\n\n${WIDGET_CREDENTIAL_RISK} Requires \`confirm: true\` and the \`versionId\` you reviewed. ${FLAG_NOTE}`,
    errors: [400, 404, 412],
    operationId: 'widgets.dryRun',
    summary: 'Dry-run a widget version',
    tags: TAGS,
  }),
  requireAuth,
  widgetPublish,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', DryRunWidgetRequestSchema),
  async (c) => controller().dryRun(c),
);

WidgetRoutes.post(
  '/:id/publish',
  routeDoc({
    data: WidgetPublishResultSchema,
    description: `Makes a version live. A draft needs a successful dry run of the same content first (412 otherwise); the widget then refreshes on its schedule — adopting the one the manifest suggests when it has none.\n\n${WIDGET_CREDENTIAL_RISK} Requires \`confirm: true\` and the \`versionId\` you reviewed. ${FLAG_NOTE}`,
    errors: [400, 404, 412],
    operationId: 'widgets.publish',
    summary: 'Publish a widget version',
    tags: TAGS,
  }),
  requireAuth,
  widgetPublish,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', PublishWidgetRequestSchema),
  async (c) => controller().publish(c),
);

// ==================== Runs ====================

WidgetRoutes.post(
  '/:id/runs',
  routeDoc({
    data: WidgetRunSchema,
    description: `Refreshes the published version now and returns the finished run. Any member who can see the widget may run it.\n\n${WIDGET_CREDENTIAL_RISK} Requires \`confirm: true\`. ${FLAG_NOTE}`,
    errors: [400, 404, 412],
    operationId: 'widgets.run',
    summary: 'Run a widget',
    tags: TAGS,
  }),
  requireAuth,
  widgetPublish,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', RunWidgetRequestSchema),
  async (c) => controller().run(c),
);

WidgetRoutes.get(
  '/:id/runs',
  routeDoc({
    data: WidgetRunListResponseSchema,
    description: `The most recent runs — previews, manual runs and scheduled refreshes — newest first. ${FLAG_NOTE}`,
    errors: [400, 404],
    summary: 'List widget runs',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('param', WidgetIdParamSchema),
  zValidator('query', WidgetRunListQuerySchema),
  async (c) => controller().listRuns(c),
);

WidgetRoutes.get(
  '/:id/runs/:runId',
  routeDoc({
    data: WidgetRunSchema,
    description: `One run with its output, stdout, stderr and error. ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'widgets.getRun',
    summary: 'Get a widget run',
    tags: TAGS,
  }),
  requireAuth,
  widgetRead,
  zValidator('param', WidgetRunParamSchema),
  async (c) => controller().getRun(c),
);

WidgetRoutes.put(
  '/:id/schedule',
  routeDoc({
    data: WidgetSchema,
    description: `Sets the refresh schedule (cron pattern) or clears it with \`null\`. Scheduled refreshes run the published version.\n\n${WIDGET_CREDENTIAL_RISK} ${FLAG_NOTE}`,
    errors: [400, 404],
    operationId: 'widgets.updateSchedule',
    summary: 'Set the widget schedule',
    tags: TAGS,
  }),
  requireAuth,
  widgetPublish,
  zValidator('param', WidgetIdParamSchema),
  zValidator('json', UpdateWidgetScheduleRequestSchema),
  async (c) => controller().updateSchedule(c),
);

export default WidgetRoutes;
