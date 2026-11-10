import type {
  LinearConnectionMetadata,
  LinearIssueStateType,
  LinearSyncResult,
} from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz, varchar255 } from './_helpers';
import { projects } from './project';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A LobeHub scope's OAuth connection to one Linear organization. Unlike a
 * GitHub App installation, a Linear OAuth token belongs to the person who
 * authorized it, so the row holds the (encrypted) token and every API call
 * made for the connection runs with it.
 *
 * The same Linear organization may be connected from several scopes; each
 * keeps its own token.
 */
export const linearConnections = pgTable(
  'linear_connections',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** LobeHub user who connected. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for a personal connection; set when connected from a workspace. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    organizationId: varchar255('organization_id').notNull(),
    organizationName: varchar255('organization_name').notNull(),
    /** Workspace slug in `linear.app/<urlKey>`. */
    organizationUrlKey: varchar255('organization_url_key').notNull(),

    /** Linear user who authorized the connection. */
    actorExternalId: varchar255('actor_external_id').notNull(),
    actorName: varchar255('actor_name').notNull(),

    /** `KeyVaultsGateKeeper`-encrypted `LinearConnectionCredentials`; null once revoked. */
    credentials: text('credentials'),
    tokenExpiresAt: timestamptz('token_expires_at'),

    /** Set on disconnect; reconnecting the same organization clears it. */
    revokedAt: timestamptz('revoked_at'),

    metadata: jsonb('metadata').$type<LinearConnectionMetadata>().default({}).notNull(),

    ...timestamps,
  },
  (t) => [
    /** Re-authorizing the same organization from the same scope refreshes the row. */
    uniqueIndex('linear_connections_org_personal_unique')
      .on(t.organizationId, t.userId)
      .where(isNull(t.workspaceId)),
    uniqueIndex('linear_connections_org_workspace_unique')
      .on(t.organizationId, t.userId, t.workspaceId)
      .where(isNotNull(t.workspaceId)),
    index('linear_connections_user_id_idx').on(t.userId),
    index('linear_connections_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewLinearConnection = typeof linearConnections.$inferInsert;
export type LinearConnectionItem = typeof linearConnections.$inferSelect;

/**
 * A LobeHub project's saved "sync this Linear team (or one of its projects)
 * into my tasks" rule, so the same filter can be re-run with one click.
 * Syncing is one way and manual: nothing here writes to Linear or runs on a
 * schedule.
 */
export const linearSyncRules = pgTable(
  'linear_sync_rules',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    /** LobeHub project the rule belongs to; its new tasks land there. */
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    connectionId: uuid('connection_id')
      .references(() => linearConnections.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    teamId: varchar255('team_id').notNull(),
    teamName: varchar255('team_name').notNull(),
    /** Null syncs the whole team. */
    linearProjectId: varchar255('linear_project_id'),
    linearProjectName: varchar255('linear_project_name'),
    /** Linear state categories to import, e.g. everything but `completed` / `canceled`. */
    stateTypes: jsonb('state_types').$type<LinearIssueStateType[]>().notNull(),

    lastRunAt: timestamptz('last_run_at'),
    lastResult: jsonb('last_result').$type<LinearSyncResult>(),

    ...timestamps,
  },
  (t) => [
    index('linear_sync_rules_project_id_idx').on(t.projectId),
    index('linear_sync_rules_connection_id_idx').on(t.connectionId),
    index('linear_sync_rules_user_id_idx').on(t.userId),
    index('linear_sync_rules_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewLinearSyncRule = typeof linearSyncRules.$inferInsert;
export type LinearSyncRuleItem = typeof linearSyncRules.$inferSelect;
