import type {
  UserMemoryContextProjectSource,
  UserMemoryDossierDecision,
  UserMemoryDossierStatus,
  UserMemoryVisibility,
} from '@lobechat/types';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { agents } from '../agent';
import { projects } from '../project';
import { users } from '../user';
import { workspaces } from '../workspace';
import { userMemories } from './base';

export const userMemoriesContexts = pgTable(
  'user_memories_contexts',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Parent row in `user_memories`, like every other layer, so contexts share search and access stats. */
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),
    /** @deprecated Loose links from the per-topic era; dossiers now point at their context. */
    userMemoryIds: jsonb('user_memory_ids').$type<string[]>(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    associatedObjects:
      jsonb('associated_objects').$type<
        { extra?: Record<string, unknown>; name?: string; type?: string }[]
      >(),
    associatedSubjects:
      jsonb('associated_subjects').$type<
        { extra?: Record<string, unknown>; name?: string; type?: string }[]
      >(),

    title: text('title'),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),

    type: varchar255('type'),
    currentStatus: text('current_status'),

    scoreImpact: numeric('score_impact', { mode: 'number' }).default(0),
    scoreUrgency: numeric('score_urgency', { mode: 'number' }).default(0),

    /** Where things stand now, synthesized from the dossiers' evidence. */
    now: text('now'),
    nextSteps: jsonb('next_steps').$type<string[]>(),
    openQuestions: jsonb('open_questions').$type<string[]>(),
    firstSeenAt: timestamptz('first_seen_at'),
    /** Status is derived from this, not from what an extractor wrote. */
    lastEvidenceAt: timestamptz('last_evidence_at'),
    /** Last periodic regroup that rewrote this context. */
    synthesizedAt: timestamptz('synthesized_at'),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_memories_contexts_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_contexts_type_index').on(table.type),
    index('user_memories_contexts_user_id_index').on(table.userId),
    index('user_memories_contexts_user_memory_ids_gin_idx').using('gin', table.userMemoryIds),
  ],
);

/**
 * A concrete item inside a context (one feature, one deal, one investigation). Activities are its
 * evidence; its summary, "now" and decisions are synthesized from them.
 */
export const userMemoriesDossiers = pgTable(
  'user_memories_dossiers',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),
    /** Null until the periodic regroup places the dossier in a context. */
    contextId: varchar255('context_id').references(() => userMemoriesContexts.id, {
      onDelete: 'set null',
    }),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Owning agent when this is the agent's own memory; null for the user's personal memory. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    /** Owning project (1:1). Many-to-many relevance to projects lives in `user_memories_context_projects`. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    title: text('title'),
    summary: text('summary'),
    summaryVector: vector('summary_vector', { dimensions: 1024 }),
    now: text('now'),
    decisions: jsonb('decisions').$type<UserMemoryDossierDecision[]>(),

    status: text('status').$type<UserMemoryDossierStatus>().notNull().default('active'),
    firstSeenAt: timestamptz('first_seen_at'),
    lastEvidenceAt: timestamptz('last_evidence_at'),
    activityCount: integer('activity_count').notNull().default(0),

    /** Workspace visibility: personal memory stays `private`; agent / project memory may be `public`. */
    visibility: text('visibility').$type<UserMemoryVisibility>().notNull().default('private'),

    ...timestamps,
  },
  (table) => [
    index('user_memories_dossiers_summary_vector_index').using(
      'hnsw',
      table.summaryVector.op('vector_cosine_ops'),
    ),
    index('user_memories_dossiers_context_id_index').on(table.contextId),
    index('user_memories_dossiers_user_id_last_evidence_at_index').on(
      table.userId,
      table.lastEvidenceAt,
    ),
    index('user_memories_dossiers_user_memory_id_index').on(table.userMemoryId),
    index('user_memories_dossiers_workspace_visibility_idx').on(
      table.workspaceId,
      table.visibility,
      table.userId,
    ),
    index('user_memories_dossiers_agent_id_index').on(table.agentId),
    index('user_memories_dossiers_project_id_index').on(table.projectId),
  ],
);

/** Contexts and projects are many-to-many: one situation can span several projects. */
export const userMemoriesContextProjects = pgTable(
  'user_memories_context_projects',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    contextId: varchar255('context_id')
      .references(() => userMemoriesContexts.id, { onDelete: 'cascade' })
      .notNull(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    source: text('source').$type<UserMemoryContextProjectSource>().notNull(),
    /** Dossiers in the context whose evidence came from this project; orders injection. */
    evidenceCount: integer('evidence_count').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_memories_context_projects_context_id_project_id_unique').on(
      table.contextId,
      table.projectId,
    ),
    index('user_memories_context_projects_project_id_index').on(table.projectId),
    index('user_memories_context_projects_user_id_index').on(table.userId),
  ],
);
