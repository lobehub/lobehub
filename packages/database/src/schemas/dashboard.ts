import type { DashboardItemLayout, DashboardVisibility } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDeleteColumns, timestamps } from './_helpers';
import { agents } from './agent';
import { projects } from './project';
import { users } from './user';
import { widgets } from './widget';
import { workspaces } from './workspace';

// ── Dashboards ───────────────────────────────────────────
//
// Same scope model as `widgets`: `user_id` is the creator and always set;
// `workspace_id` / `project_id` / `agent_id` are optional and together decide
// the direct level the board lives on (personal, workspace, project, agent).
// A board may carry both a project and an agent (an agent's board inside a
// project). The project and agent must belong to the same workspace as the
// board itself; the model layer enforces that because a composite FK cannot
// express "NULL = personal".
//
// The partial list indexes mirror those levels one to one and skip trashed
// rows, so every "list what lives directly here" query walks one small index.

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

/**
 * One item placed on a board. Today every item is a widget; the table keeps
 * the generic name so non-widget items (text blocks, section headers) can be
 * added later without a rename.
 */
export const dashboardItems = pgTable(
  'dashboard_items',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    dashboardId: uuid('dashboard_id')
      .references(() => dashboards.id, { onDelete: 'cascade' })
      .notNull(),
    widgetId: uuid('widget_id')
      .references(() => widgets.id, { onDelete: 'cascade' })
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

export type DashboardRow = typeof dashboards.$inferSelect;
export type NewDashboardRow = typeof dashboards.$inferInsert;
export type DashboardItemRow = typeof dashboardItems.$inferSelect;
export type NewDashboardItemRow = typeof dashboardItems.$inferInsert;
