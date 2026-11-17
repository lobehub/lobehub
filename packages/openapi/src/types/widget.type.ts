import {
  WIDGET_OUTPUT_TYPES,
  WIDGET_RUN_STATUSES,
  WIDGET_RUN_TRIGGERS,
  WIDGET_RUNTIMES,
  WIDGET_VERSION_SOURCES,
  WIDGET_VERSION_STATUSES,
  WIDGET_VISIBILITIES,
} from '@lobechat/types';
import { widgetManifestSchema, widgetOutputSchema, widgetViewSchema } from '@lobechat/widget-spec';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

/**
 * Widgets on the public REST API: a widget is a small script whose JSON output
 * renders as a card. Its script lives in versions — a draft is dry-run, then
 * published — and every refresh is a run. Rules are the `widget` tRPC
 * router's, called server-side.
 */

// ==================== Shared ====================

export const WIDGET_CREDENTIAL_RISK =
  "**Runs with your credentials.** The script executes in a sandbox with the connector credentials and network hosts its manifest declares, on the caller's behalf. Read the version's `script` and `manifest` before confirming. Restricted API keys need `widget:publish`.";

const uuid = z.uuid();

export const WidgetIdParamSchema = z.object({ id: uuid.describe('Widget id.') });

export const WidgetVersionParamSchema = WidgetIdParamSchema.extend({ versionId: uuid });

export const WidgetRunParamSchema = WidgetIdParamSchema.extend({ runId: uuid });

const visibility = z
  .enum(WIDGET_VISIBILITIES)
  .describe('`public` widgets are visible to the whole workspace; `private` ones to the creator.');

/**
 * The card template is a recursive tree checked in full by the shared widget
 * content schema when a draft is saved; the transport only fixes it as an object.
 */
const viewSchema = widgetViewSchema.extend({
  layout: jsonObjectSchema.optional().describe('Declarative card layout tree.'),
});

const levelFields = {
  agentId: z.string().nullable().describe('Owning agent, when the widget lives on an agent.'),
  projectId: z.string().nullable().describe('Owning project, when the widget lives on a project.'),
};

export const DashboardItemLayoutSchema = z
  .object({
    h: z.number().int().min(1).max(48),
    w: z.number().int().min(1).max(48),
    x: z.number().int().min(0).max(96),
    y: z.number().int().min(0),
  })
  .meta({ description: 'Grid placement in grid units.', id: 'DashboardItemLayout' });

// ==================== Responses ====================

const runErrorSchema = z.object({
  code: z
    .string()
    .describe('`INVALID_OUTPUT`, `SANDBOX_ERROR`, `SANDBOX_BUSY`, `NON_ZERO_EXIT`, …'),
  message: z.string(),
});

export const WidgetOutputSchema = widgetOutputSchema.meta({
  description: 'One widget output document: a stat, list, series, table or free-form data.',
  id: 'WidgetOutput',
});

export const WidgetSchema = z
  .object({
    ...levelFields,
    consecutiveFailures: z.number().int(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    draftVersionId: z.string().nullable(),
    id: z.string(),
    lastRunAt: dateTimeSchema.nullable(),
    lastRunError: runErrorSchema.nullable(),
    lastRunStatus: z.enum(WIDGET_RUN_STATUSES).nullable(),
    latestOutput: WidgetOutputSchema.nullable(),
    latestOutputAt: dateTimeSchema.nullable(),
    metadata: jsonObjectSchema.nullable(),
    nextRunAt: dateTimeSchema.nullable(),
    publishedVersionId: z.string().nullable(),
    schedulePattern: z.string().nullable().describe('Cron pattern of the refresh schedule.'),
    scheduleTimezone: z.string().nullable(),
    title: z.string(),
    updatedAt: dateTimeSchema,
    userId: z.string().describe('The creator.'),
    visibility,
    workspaceId: z.string().nullable(),
  })
  .meta({ id: 'Widget' });

export type WidgetResponse = z.infer<typeof WidgetSchema>;

export const WidgetListResponseSchema = paginatedListSchema(WidgetSchema, { total: true });

export const WidgetVersionSchema = z
  .object({
    changeNote: z.string().nullable(),
    contentHash: z.string(),
    createdAt: dateTimeSchema,
    id: z.string(),
    manifest: widgetManifestSchema.nullable(),
    outputType: z.enum(WIDGET_OUTPUT_TYPES),
    parentVersionId: z.string().nullable(),
    publishedAt: dateTimeSchema.nullable(),
    runtime: z.enum(WIDGET_RUNTIMES),
    script: z.string(),
    sourceAgentId: z.string().nullable(),
    sourceTopicId: z.string().nullable(),
    sourceType: z.enum(WIDGET_VERSION_SOURCES),
    status: z.enum(WIDGET_VERSION_STATUSES),
    updatedAt: dateTimeSchema,
    version: z.number().int(),
    view: viewSchema.nullable(),
    widgetId: z.string(),
  })
  .meta({ id: 'WidgetVersion' });

export type WidgetVersionResponse = z.infer<typeof WidgetVersionSchema>;

export const WidgetVersionListResponseSchema = z.object({ items: z.array(WidgetVersionSchema) });

export const WidgetDetailSchema = WidgetSchema.extend({
  dashboards: z
    .array(z.object({ id: z.string(), projectId: z.string().nullable(), title: z.string() }))
    .describe('The boards the widget is placed on.'),
  draftVersion: WidgetVersionSchema.nullable(),
  publishedVersion: WidgetVersionSchema.nullable(),
}).meta({ id: 'WidgetDetail' });

export type WidgetDetailResponse = z.infer<typeof WidgetDetailSchema>;

export const WidgetRunSchema = z
  .object({
    createdAt: dateTimeSchema,
    durationMs: z.number().int().nullable(),
    error: runErrorSchema.nullable(),
    exitCode: z.number().int().nullable(),
    finishedAt: dateTimeSchema.nullable(),
    id: z.string(),
    output: WidgetOutputSchema.nullable(),
    startedAt: dateTimeSchema,
    status: z.enum(WIDGET_RUN_STATUSES),
    stderr: z.string().nullable(),
    stdout: z.string().nullable(),
    trigger: z
      .enum(WIDGET_RUN_TRIGGERS)
      .describe('`preview` for a dry run, `manual` for a run now, `schedule` for a refresh.'),
    versionId: z.string(),
    widgetId: z.string(),
  })
  .meta({ id: 'WidgetRun' });

export type WidgetRunResponse = z.infer<typeof WidgetRunSchema>;

export const WidgetRunListResponseSchema = z.object({ items: z.array(WidgetRunSchema) });

export const WidgetPublishResultSchema = z
  .object({ version: WidgetVersionSchema, widget: WidgetSchema })
  .meta({ id: 'WidgetPublishResult' });

// ==================== Requests ====================

export const WidgetListQuerySchema = CursorPaginationQuerySchema.extend({
  agentId: z.string().min(1).optional().describe('Widgets living on this agent.'),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe('Widgets living on this project (not its agents).'),
});

export type WidgetListQuery = z.infer<typeof WidgetListQuerySchema>;

export const CreateWidgetRequestSchema = z.object({
  agentId: z.string().min(1).optional().describe('Put the widget on this agent.'),
  dashboardId: uuid
    .optional()
    .describe(
      'Place the widget on this board in the same transaction; fails as a whole when it cannot.',
    ),
  description: z.string().max(2000).nullable().optional(),
  layout: DashboardItemLayoutSchema.optional().describe('Placement on `dashboardId`.'),
  metadata: jsonObjectSchema.nullable().optional(),
  projectId: z.string().min(1).optional().describe('Put the widget on this project.'),
  title: z.string().min(1).max(200),
  visibility: visibility.optional(),
});

export type CreateWidgetRequest = z.infer<typeof CreateWidgetRequestSchema>;

export const UpdateWidgetRequestSchema = z
  .object({
    description: z.string().max(2000).nullable().optional(),
    metadata: jsonObjectSchema.nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    visibility: visibility.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });

export type UpdateWidgetRequest = z.infer<typeof UpdateWidgetRequestSchema>;

export const SaveWidgetDraftRequestSchema = z.object({
  changeNote: z.string().max(500).nullable().optional(),
  manifest: widgetManifestSchema
    .nullable()
    .optional()
    .describe('Connectors, hosts, params, metric and suggested schedule the script needs.'),
  outputType: z.enum(WIDGET_OUTPUT_TYPES).describe('The output contract stdout must match.'),
  runtime: z.enum(WIDGET_RUNTIMES),
  script: z
    .string()
    .min(1)
    .max(256 * 1024),
  view: viewSchema.nullable().optional(),
});

export type SaveWidgetDraftRequest = z.infer<typeof SaveWidgetDraftRequestSchema>;

const confirm = z
  .literal(true)
  .describe('Must be `true`: you confirm the script may run with your credentials.');

export const DryRunWidgetRequestSchema = z.object({
  confirm,
  versionId: uuid.describe('The version to execute — normally the draft you just saved.'),
});

export type DryRunWidgetRequest = z.infer<typeof DryRunWidgetRequestSchema>;

export const PublishWidgetRequestSchema = z.object({
  confirm: z
    .literal(true)
    .describe(
      'Must be `true`: you confirm this version goes live and refreshes with your credentials.',
    ),
  versionId: uuid.describe('The version to publish. A draft needs a successful dry run first.'),
});

export type PublishWidgetRequest = z.infer<typeof PublishWidgetRequestSchema>;

export const RunWidgetRequestSchema = z.object({ confirm });

export const WidgetRunListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Most recent runs, 1–100. Defaults to 20.'),
});

export type WidgetRunListQuery = z.infer<typeof WidgetRunListQuerySchema>;

export const UpdateWidgetScheduleRequestSchema = z.object({
  pattern: z
    .string()
    .max(100)
    .nullable()
    .describe('Cron pattern (`0 * * * *`), or `null` to stop refreshing.'),
  timezone: z.string().max(64).nullable().optional().describe('IANA timezone of the pattern.'),
});

export type UpdateWidgetScheduleRequest = z.infer<typeof UpdateWidgetScheduleRequestSchema>;
