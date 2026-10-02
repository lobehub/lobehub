import type {
  DashboardItemLayout,
  DashboardVisibility,
  DashboardWidgetRunError,
  DashboardWidgetRunStatus,
  DashboardWidgetRuntime,
  DashboardWidgetRunTrigger,
  DashboardWidgetVersionSource,
  DashboardWidgetVersionStatus,
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetView,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, softDeleteColumns, timestamps, timestamptz, updatedAt } from './_helpers';
import { agents } from './agent';
import { metrics } from './metric';
import { projects } from './project';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

// ── Dashboards ───────────────────────────────────────────
//
// Scope model shared by `dashboards` and `dashboard_widgets`: `user_id` is the
// creator and always set; `workspace_id` / `project_id` / `agent_id` are
// optional and together decide the direct level the row lives on (personal,
// workspace, project, agent — see `DashboardLevel`). A row may carry both a
// project and an agent (an agent's board inside a project). The project and
// agent must belong to the same workspace as the row itself; the model layer
// enforces that because a composite FK cannot express "NULL = personal".
//
// The partial list indexes below mirror those levels one to one and skip
// trashed rows, so every "list what lives directly here" query walks exactly
// one small index.

/** A board: a named, laid-out collection of widgets at one ownership level. */
export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),
    /** Emoji or icon name shown beside the title. */
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),

    visibility: text('visibility').$type<DashboardVisibility>().notNull().default('public'),
    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (t) => [
    index('dashboards_personal_idx')
      .on(t.userId, t.sortOrder)
      .where(
        sql`${t.workspaceId} IS NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboards_workspace_idx')
      .on(t.workspaceId, t.sortOrder)
      .where(
        sql`${t.workspaceId} IS NOT NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboards_project_idx')
      .on(t.projectId, t.sortOrder)
      .where(
        sql`${t.projectId} IS NOT NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboards_agent_idx')
      .on(t.agentId, t.sortOrder)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.isDeleted} IS NOT TRUE`),
    index('dashboards_user_id_idx').on(t.userId),
    index('dashboards_workspace_id_idx').on(t.workspaceId),
  ],
);

// ── Widgets ──────────────────────────────────────────────

/**
 * A widget: a scheduled script whose JSON stdout is rendered as a card. It is
 * a standalone entity (placed on boards through `dashboard_items`) so the
 * same widget can appear on several boards and keeps its run history when
 * removed from one.
 *
 * The widget row is the hot read model: it carries the latest successful
 * output and the last run's summary so a board renders without touching the
 * runs table.
 */
export const dashboardWidgets = pgTable(
  'dashboard_widgets',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),

    /** Version scheduled and manual runs execute. NULL until first publish. */
    publishedVersionId: uuid('published_version_id').references(
      (): AnyPgColumn => dashboardWidgetVersions.id,
      { onDelete: 'set null' },
    ),
    /** Latest unpublished version being authored; cleared when it is published. */
    draftVersionId: uuid('draft_version_id').references(
      (): AnyPgColumn => dashboardWidgetVersions.id,
      { onDelete: 'set null' },
    ),

    // ── Schedule ──
    /** Cron pattern, e.g. '0 * * * *'. NULL means manual refresh only. */
    schedulePattern: text('schedule_pattern'),
    /** IANA zone the pattern is evaluated in, e.g. 'Asia/Shanghai'. */
    scheduleTimezone: text('schedule_timezone'),
    /**
     * Next due instant, computed by the service from the pattern. The
     * scheduler claims a due widget by moving this forward (compare-and-set),
     * so two ticks never fire the same slot.
     */
    nextRunAt: timestamptz('next_run_at'),

    // ── Last run snapshot (denormalized from dashboard_widget_runs) ──
    lastRunId: uuid('last_run_id'),
    lastRunAt: timestamptz('last_run_at'),
    lastRunStatus: text('last_run_status').$type<DashboardWidgetRunStatus>(),
    lastRunError: jsonb('last_run_error').$type<DashboardWidgetRunError>(),
    /** Failures since the last success; drives back-off and the failing badge. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Output of the most recent successful non-preview run. */
    latestOutput: jsonb('latest_output').$type<WidgetOutput>(),
    latestOutputAt: timestamptz('latest_output_at'),

    /** Numeric trend series in `metrics` (subject_type = 'dashboardWidget'). */
    metricId: text('metric_id').references(() => metrics.id, { onDelete: 'set null' }),

    visibility: text('visibility').$type<DashboardVisibility>().notNull().default('public'),
    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (t) => [
    index('dashboard_widgets_personal_idx')
      .on(t.userId, t.updatedAt)
      .where(
        sql`${t.workspaceId} IS NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboard_widgets_workspace_idx')
      .on(t.workspaceId, t.updatedAt)
      .where(
        sql`${t.workspaceId} IS NOT NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboard_widgets_project_idx')
      .on(t.projectId, t.updatedAt)
      .where(
        sql`${t.projectId} IS NOT NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboard_widgets_agent_idx')
      .on(t.agentId, t.updatedAt)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.isDeleted} IS NOT TRUE`),
    // Scheduler due query: live, published, scheduled widgets ordered by due time.
    index('dashboard_widgets_due_idx')
      .on(t.nextRunAt)
      .where(
        sql`${t.nextRunAt} IS NOT NULL AND ${t.schedulePattern} IS NOT NULL AND ${t.publishedVersionId} IS NOT NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('dashboard_widgets_user_id_idx').on(t.userId),
    index('dashboard_widgets_workspace_id_idx').on(t.workspaceId),
    index('dashboard_widgets_published_version_id_idx').on(t.publishedVersionId),
    index('dashboard_widgets_draft_version_id_idx').on(t.draftVersionId),
    index('dashboard_widgets_metric_id_idx').on(t.metricId),
  ],
);

/** Placement of a widget on a board. */
export const dashboardItems = pgTable(
  'dashboard_items',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    dashboardId: uuid('dashboard_id')
      .references(() => dashboards.id, { onDelete: 'cascade' })
      .notNull(),
    widgetId: uuid('widget_id')
      .references(() => dashboardWidgets.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    layout: jsonb('layout').$type<DashboardItemLayout>(),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('dashboard_items_dashboard_id_widget_id_unique').on(t.dashboardId, t.widgetId),
    index('dashboard_items_dashboard_id_sort_order_idx').on(t.dashboardId, t.sortOrder),
    index('dashboard_items_widget_id_idx').on(t.widgetId),
    index('dashboard_items_user_id_idx').on(t.userId),
    index('dashboard_items_workspace_id_idx').on(t.workspaceId),
  ],
);

// ── Versions ─────────────────────────────────────────────

/**
 * Immutable snapshots of a widget's script + contract. Editing creates a new
 * draft version; publishing points the widget at it. `content_hash` lets the
 * service skip creating a version identical to the current draft.
 */
export const dashboardWidgetVersions = pgTable(
  'dashboard_widget_versions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    widgetId: uuid('widget_id')
      .references((): AnyPgColumn => dashboardWidgets.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Monotonic per widget, starting at 1. */
    version: integer('version').notNull(),
    runtime: text('runtime').$type<DashboardWidgetRuntime>().notNull(),
    script: text('script').notNull(),
    /** sha256 over runtime + script + manifest + outputType + view. */
    contentHash: text('content_hash').notNull(),
    manifest: jsonb('manifest').$type<WidgetManifest>(),
    outputType: text('output_type').$type<WidgetOutputType>().notNull(),
    view: jsonb('view').$type<WidgetView>(),
    status: text('status').$type<DashboardWidgetVersionStatus>().notNull().default('draft'),
    /** Author's summary of what changed, e.g. 'switch to GraphQL API'. */
    changeNote: text('change_note'),

    // ── Publish ──
    publishedAt: timestamptz('published_at'),
    publishedByUserId: text('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // ── Provenance ──
    sourceType: text('source_type').$type<DashboardWidgetVersionSource>().notNull(),
    /** Agent that wrote the script when `source_type = 'agent'`. */
    sourceAgentId: text('source_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Conversation the version was authored in. */
    sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    /** Message carrying the authoring tool call; no FK, messages are high churn. */
    sourceMessageId: text('source_message_id'),
    /** Agent run that produced the version — join key into agent-tracing. */
    sourceOperationId: text('source_operation_id'),
    /** Version this one was derived from. */
    parentVersionId: uuid('parent_version_id').references(
      (): AnyPgColumn => dashboardWidgetVersions.id,
      { onDelete: 'set null' },
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('dashboard_widget_versions_widget_id_version_unique').on(t.widgetId, t.version),
    index('dashboard_widget_versions_user_id_idx').on(t.userId),
    index('dashboard_widget_versions_workspace_id_idx').on(t.workspaceId),
    index('dashboard_widget_versions_source_agent_id_idx').on(t.sourceAgentId),
    index('dashboard_widget_versions_source_topic_id_idx').on(t.sourceTopicId),
    index('dashboard_widget_versions_parent_version_id_idx').on(t.parentVersionId),
  ],
);

// ── Runs ─────────────────────────────────────────────────

/** One sandbox execution of a widget version. Append-mostly history. */
export const dashboardWidgetRuns = pgTable(
  'dashboard_widget_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    widgetId: uuid('widget_id')
      .references(() => dashboardWidgets.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id')
      .references(() => dashboardWidgetVersions.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    trigger: text('trigger').$type<DashboardWidgetRunTrigger>().notNull(),
    status: text('status').$type<DashboardWidgetRunStatus>().notNull().default('running'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    durationMs: integer('duration_ms'),
    exitCode: integer('exit_code'),
    /** Parsed stdout when it matched the output contract. */
    output: jsonb('output').$type<WidgetOutput>(),
    /** Raw streams, truncated by the service before persisting. */
    stdout: text('stdout'),
    stderr: text('stderr'),
    error: jsonb('error').$type<DashboardWidgetRunError>(),
    /** Sandbox execution id returned by the runner, for log correlation. */
    sandboxId: text('sandbox_id'),
    /** Agent run that triggered a preview — join key into agent-tracing. */
    operationId: text('operation_id'),

    createdAt: createdAt(),
  },
  (t) => [
    index('dashboard_widget_runs_widget_id_created_at_idx').on(t.widgetId, t.createdAt),
    index('dashboard_widget_runs_version_id_idx').on(t.versionId),
    index('dashboard_widget_runs_user_id_idx').on(t.userId),
    index('dashboard_widget_runs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type DashboardRow = typeof dashboards.$inferSelect;
export type NewDashboardRow = typeof dashboards.$inferInsert;
export type DashboardItemRow = typeof dashboardItems.$inferSelect;
export type NewDashboardItemRow = typeof dashboardItems.$inferInsert;
export type DashboardWidgetRow = typeof dashboardWidgets.$inferSelect;
export type NewDashboardWidgetRow = typeof dashboardWidgets.$inferInsert;
export type DashboardWidgetVersionRow = typeof dashboardWidgetVersions.$inferSelect;
export type NewDashboardWidgetVersionRow = typeof dashboardWidgetVersions.$inferInsert;
export type DashboardWidgetRunRow = typeof dashboardWidgetRuns.$inferSelect;
export type NewDashboardWidgetRunRow = typeof dashboardWidgetRuns.$inferInsert;
