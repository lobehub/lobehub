import type {
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetRunError,
  WidgetRunStatus,
  WidgetRuntime,
  WidgetRunTrigger,
  WidgetVersionSource,
  WidgetVersionStatus,
  WidgetView,
  WidgetVisibility,
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

// ── Widgets ──────────────────────────────────────────────
//
// Scope model: `user_id` is the creator and always set; `workspace_id` /
// `project_id` / `agent_id` are optional and together decide the direct level
// the widget lives on (personal, workspace, project, agent — see
// `WidgetLevel`). A row may carry both a project and an agent (an agent's
// widget inside a project). The project and agent must belong to the same
// workspace as the row itself; the model layer enforces that (see
// `utils/scopeLevel.ts`) because a composite FK cannot express "NULL =
// personal".
//
// The partial list indexes below mirror those levels one to one and skip
// trashed rows, so every "list what lives directly here" query walks exactly
// one small index.

/**
 * A widget: a scheduled script whose JSON stdout is rendered as a card. It is
 * a standalone entity so any host surface (boards, goals, …) can mount the
 * same widget, and it keeps its run history independently of where it is
 * shown.
 *
 * The widget row is the hot read model: it carries the latest usable output
 * and the last run's summary so a host renders without touching the runs
 * table.
 */
export const widgets = pgTable(
  'widgets',
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
      (): AnyPgColumn => widgetVersions.id,
      { onDelete: 'set null' },
    ),
    /** Latest unpublished version being authored; cleared when it is published. */
    draftVersionId: uuid('draft_version_id').references((): AnyPgColumn => widgetVersions.id, {
      onDelete: 'set null',
    }),

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

    // ── Last run snapshot (denormalized from widget_runs, previews excluded) ──
    lastRunId: uuid('last_run_id'),
    lastRunAt: timestamptz('last_run_at'),
    lastRunStatus: text('last_run_status').$type<WidgetRunStatus>(),
    lastRunError: jsonb('last_run_error').$type<WidgetRunError>(),
    /** Failed / timed-out runs since the last usable one; drives back-off and the failing badge. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Output of the most recent `succeeded` or `partial` non-preview run. */
    latestOutput: jsonb('latest_output').$type<WidgetOutput>(),
    latestOutputAt: timestamptz('latest_output_at'),

    /** Numeric trend series in `metrics` (subject_type = 'widget'). */
    metricId: text('metric_id').references(() => metrics.id, { onDelete: 'set null' }),

    /**
     * Consumer-owned extras (UI state, integration wiring, …) that no query
     * filters on. Keep typed, queried fields as real columns.
     */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    /**
     * Workspace visibility. Forced to 'private' at creation when the attached
     * project or agent is private, so a widget never outshares its parent.
     */
    visibility: text('visibility').$type<WidgetVisibility>().notNull().default('public'),
    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (t) => [
    index('widgets_personal_idx')
      .on(t.userId, t.updatedAt)
      .where(
        sql`${t.workspaceId} IS NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('widgets_workspace_idx')
      .on(t.workspaceId, t.updatedAt)
      .where(
        sql`${t.workspaceId} IS NOT NULL AND ${t.projectId} IS NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('widgets_project_idx')
      .on(t.projectId, t.updatedAt)
      .where(
        sql`${t.projectId} IS NOT NULL AND ${t.agentId} IS NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('widgets_agent_idx')
      .on(t.agentId, t.updatedAt)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.isDeleted} IS NOT TRUE`),
    // Scheduler due query: live, published, scheduled widgets ordered by due time.
    index('widgets_due_idx')
      .on(t.nextRunAt)
      .where(
        sql`${t.nextRunAt} IS NOT NULL AND ${t.schedulePattern} IS NOT NULL AND ${t.publishedVersionId} IS NOT NULL AND ${t.isDeleted} IS NOT TRUE`,
      ),
    index('widgets_user_id_idx').on(t.userId),
    index('widgets_workspace_id_idx').on(t.workspaceId),
    index('widgets_published_version_id_idx').on(t.publishedVersionId),
    index('widgets_draft_version_id_idx').on(t.draftVersionId),
    index('widgets_metric_id_idx').on(t.metricId),
  ],
);

// ── Versions ─────────────────────────────────────────────

/**
 * Immutable snapshots of a widget's script + contract. Editing creates a new
 * draft version; publishing points the widget at it. `content_hash` lets the
 * model skip creating a version identical to the current draft.
 */
export const widgetVersions = pgTable(
  'widget_versions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    widgetId: uuid('widget_id')
      .references((): AnyPgColumn => widgets.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Monotonic per widget, starting at 1. */
    version: integer('version').notNull(),
    runtime: text('runtime').$type<WidgetRuntime>().notNull(),
    script: text('script').notNull(),
    /** sha256 over runtime + script + manifest + outputType + view. */
    contentHash: text('content_hash').notNull(),
    manifest: jsonb('manifest').$type<WidgetManifest>(),
    outputType: text('output_type').$type<WidgetOutputType>().notNull(),
    view: jsonb('view').$type<WidgetView>(),
    status: text('status').$type<WidgetVersionStatus>().notNull().default('draft'),
    /** Author's summary of what changed, e.g. 'switch to GraphQL API'. */
    changeNote: text('change_note'),

    // ── Publish ──
    publishedAt: timestamptz('published_at'),
    publishedByUserId: text('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // ── Provenance ──
    sourceType: text('source_type').$type<WidgetVersionSource>().notNull(),
    /** Agent that wrote the script when `source_type = 'agent'`. */
    sourceAgentId: text('source_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Conversation the version was authored in. */
    sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    /** Message carrying the authoring tool call; no FK, messages are high churn. */
    sourceMessageId: text('source_message_id'),
    /** Agent run that produced the version — join key into agent-tracing. */
    sourceOperationId: text('source_operation_id'),
    /** Version this one was derived from. */
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => widgetVersions.id, {
      onDelete: 'set null',
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('widget_versions_widget_id_version_unique').on(t.widgetId, t.version),
    index('widget_versions_user_id_idx').on(t.userId),
    index('widget_versions_workspace_id_idx').on(t.workspaceId),
    index('widget_versions_source_agent_id_idx').on(t.sourceAgentId),
    index('widget_versions_source_topic_id_idx').on(t.sourceTopicId),
    index('widget_versions_parent_version_id_idx').on(t.parentVersionId),
  ],
);

// ── Runs ─────────────────────────────────────────────────

/** One sandbox execution of a widget version. Append-mostly history. */
export const widgetRuns = pgTable(
  'widget_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    widgetId: uuid('widget_id')
      .references(() => widgets.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id')
      .references(() => widgetVersions.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    trigger: text('trigger').$type<WidgetRunTrigger>().notNull(),
    /** See `WidgetRunStatus`; `partial` = valid output flagged `meta.complete === false`. */
    status: text('status').$type<WidgetRunStatus>().notNull().default('running'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    durationMs: integer('duration_ms'),
    exitCode: integer('exit_code'),
    /** Parsed stdout when it matched the output contract. */
    output: jsonb('output').$type<WidgetOutput>(),
    /** Raw streams, truncated by the service before persisting. */
    stdout: text('stdout'),
    stderr: text('stderr'),
    error: jsonb('error').$type<WidgetRunError>(),
    /** Sandbox execution id returned by the runner, for log correlation. */
    sandboxId: text('sandbox_id'),
    /** Agent run that triggered a preview — join key into agent-tracing. */
    operationId: text('operation_id'),

    createdAt: createdAt(),
  },
  (t) => [
    index('widget_runs_widget_id_created_at_idx').on(t.widgetId, t.createdAt),
    index('widget_runs_version_id_idx').on(t.versionId),
    index('widget_runs_user_id_idx').on(t.userId),
    index('widget_runs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type WidgetRow = typeof widgets.$inferSelect;
export type NewWidgetRow = typeof widgets.$inferInsert;
export type WidgetVersionRow = typeof widgetVersions.$inferSelect;
export type NewWidgetVersionRow = typeof widgetVersions.$inferInsert;
export type WidgetRunRow = typeof widgetRuns.$inferSelect;
export type NewWidgetRunRow = typeof widgetRuns.$inferInsert;
