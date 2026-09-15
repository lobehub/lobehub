import type {
  ProjectCompletionDecision,
  ProjectStatus,
  ProjectVisibility,
  ProjectWorkingDirectoryPermission,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { softDeleteColumns, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { chatGroups } from './chatGroup';
import { devices } from './device';
import { knowledgeBases } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A long-lived, goal-oriented scope of work. A project organizes reusable agents
 * and knowledge around tasks and deliverables, but does not own those reusable
 * resources or expand their permissions.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('projects'))
      .notNull(),
    slug: varchar('slug', { length: 100 }).$defaultFn(() => randomSlug(3)),
    /** Human-readable task prefix within the project scope, for example LOBE. */
    identifier: varchar('identifier', { length: 6 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    avatar: text('avatar'),

    /** Dedicated agent that coordinates all conversations and work inside this project. */
    coordinatorAgentId: text('coordinator_agent_id')
      .references(() => agents.id, { onDelete: 'restrict' })
      .notNull(),

    status: text('status').$type<ProjectStatus>().notNull().default('backlog'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    visibility: text('visibility').$type<ProjectVisibility>().notNull().default('public'),

    /**
     * The accepted completion review that currently closes this project. Soft
     * reference because project_completion_reviews points back to projects.
     * Written when status becomes completed and retained if that project is
     * subsequently archived; cleared when completed work is reopened.
     */
    completedReviewId: uuid('completed_review_id'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    archivedAt: timestamptz('archived_at'),

    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('projects_slug_user_id_unique')
      .on(t.slug, t.userId)
      .where(sql`${t.workspaceId} IS NULL`),
    uniqueIndex('projects_slug_workspace_id_unique')
      .on(t.workspaceId, t.slug)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    uniqueIndex('projects_identifier_user_id_unique')
      .on(t.identifier, t.userId)
      .where(sql`${t.workspaceId} IS NULL`),
    uniqueIndex('projects_identifier_workspace_id_unique')
      .on(t.workspaceId, t.identifier)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('projects_user_id_idx').on(t.userId),
    index('projects_workspace_id_idx').on(t.workspaceId),
    index('projects_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
    index('projects_status_updated_at_idx').on(t.status, t.updatedAt),
    uniqueIndex('projects_coordinator_agent_id_unique').on(t.coordinatorAgentId),
    check(
      'projects_completed_requires_human_review',
      sql`${t.status} <> 'completed' OR (${t.completedReviewId} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * A device-backed directory made available to a project as an execution context.
 * The directory remains device-owned; removing this binding never deletes local files.
 */
export const projectWorkingDirectories = pgTable(
  'project_working_directories',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    /** Nullable so a removed device leaves a repairable binding with its last-known path. */
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    addedByUserId: text('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Absolute path on the bound device, for example /Users/name/Code/lobehub. */
    path: text('path').notNull(),
    /** User-facing label; defaults to the final path segment at the application boundary. */
    name: varchar('name', { length: 255 }).notNull(),
    permission: text('permission')
      .$type<ProjectWorkingDirectoryPermission>()
      .notNull()
      .default('readWrite'),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_working_directories_project_device_path_unique').on(
      t.projectId,
      t.deviceId,
      t.path,
    ),
    uniqueIndex('project_working_directories_project_primary_unique')
      .on(t.projectId)
      .where(sql`${t.isPrimary} = true`),
    index('project_working_directories_project_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_working_directories_device_id_idx').on(t.deviceId),
    index('project_working_directories_workspace_id_idx').on(t.workspaceId),
    check('project_working_directories_path_not_empty', sql`length(btrim(${t.path})) > 0`),
    check('project_working_directories_name_not_empty', sql`length(btrim(${t.name})) > 0`),
  ],
);

export type NewProjectWorkingDirectory = typeof projectWorkingDirectories.$inferInsert;
export type ProjectWorkingDirectoryItem = typeof projectWorkingDirectories.$inferSelect;

/** Direct agent participation in a project; chat-group members are not duplicated here. */
export const projectAgents = pgTable(
  'project_agents',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Project-specific role, for example lead, researcher, implementer, or reviewer. */
    role: text('role'),
    /** Project-specific responsibility beyond the short role label. */
    responsibility: text('responsibility'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_agents_project_id_agent_id_unique').on(t.projectId, t.agentId),
    index('project_agents_project_id_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_agents_agent_id_idx').on(t.agentId),
    index('project_agents_workspace_id_idx').on(t.workspaceId),
  ],
);

/** A reusable multi-agent chat group participating in a project as one collaboration unit. */
export const projectChatGroups = pgTable(
  'project_chat_groups',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    chatGroupId: text('chat_group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Responsibility of the whole group in this project; group-member roles remain group-owned. */
    role: text('role'),
    responsibility: text('responsibility'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_chat_groups_project_id_chat_group_id_unique').on(
      t.projectId,
      t.chatGroupId,
    ),
    index('project_chat_groups_project_id_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_chat_groups_chat_group_id_idx').on(t.chatGroupId),
    index('project_chat_groups_workspace_id_idx').on(t.workspaceId),
  ],
);

/** Reusable knowledge made available to a project without changing resource ownership. */
export const projectKnowledgeBases = pgTable(
  'project_knowledge_bases',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_knowledge_bases_project_id_knowledge_base_id_unique').on(
      t.projectId,
      t.knowledgeBaseId,
    ),
    index('project_knowledge_bases_project_id_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_knowledge_bases_knowledge_base_id_idx').on(t.knowledgeBaseId),
    index('project_knowledge_bases_workspace_id_idx').on(t.workspaceId),
  ],
);

/**
 * Immutable human decisions on whether a project satisfies its success criteria.
 * Agents may request a review, but only a user can author one of these rows.
 */
export const projectCompletionReviews = pgTable(
  'project_completion_reviews',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    /** Human author at decision time; set null if that user account is later deleted. */
    reviewerUserId: text('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    round: integer('round').notNull(),
    decision: text('decision').$type<ProjectCompletionDecision>().notNull(),
    comment: text('comment'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_completion_reviews_project_id_round_unique').on(t.projectId, t.round),
    index('project_completion_reviews_project_id_created_at_idx').on(t.projectId, t.createdAt),
    index('project_completion_reviews_reviewer_user_id_idx').on(t.reviewerUserId),
    index('project_completion_reviews_workspace_id_idx').on(t.workspaceId),
    check('project_completion_reviews_round_positive', sql`${t.round} > 0`),
  ],
);
