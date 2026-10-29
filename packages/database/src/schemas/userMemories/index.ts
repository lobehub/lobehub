import type {
  UserMemoryContextProjectSource,
  UserMemoryDossierDecision,
  UserMemoryDossierStatus,
  UserMemoryEdgeRelation,
  UserMemoryEntityNameKind,
  UserMemoryEntityType,
  UserMemoryOperationActor,
  UserMemoryOperationGate,
  UserMemoryOperationState,
  UserMemoryOperationType,
  UserMemoryVisibility,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { softDeleteColumns, timestamps, timestamptz, varchar255 } from '../_helpers';
import { agents } from '../agent';
import { projects } from '../project';
import { users } from '../user';
import { workspaces } from '../workspace';

export const userMemories = pgTable(
  'user_memories',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    memoryCategory: varchar255('memory_category'),
    memoryLayer: varchar255('memory_layer'),
    memoryType: varchar255('memory_type'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    title: varchar255('title'),
    summary: text('summary'),
    summaryVector1024: vector('summary_vector_1024', { dimensions: 1024 }),
    details: text('details'),
    detailsVector1024: vector('details_vector_1024', { dimensions: 1024 }),

    status: varchar255('status'),

    accessedCount: bigint('accessed_count', { mode: 'number' }).default(0),
    lastAccessedAt: timestamptz('last_accessed_at').notNull(),
    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    /** Recycle bin — see `schemas/trash.ts`. */
    ...softDeleteColumns(),
    ...timestamps,
  },
  (table) => [
    index('user_memories_summary_vector_1024_index').using(
      'hnsw',
      table.summaryVector1024.op('vector_cosine_ops'),
    ),
    index('user_memories_details_vector_1024_index').using(
      'hnsw',
      table.detailsVector1024.op('vector_cosine_ops'),
    ),
    index('user_memories_user_id_index').on(table.userId),
  ],
);

export const userMemoriesContexts = pgTable(
  'user_memories_contexts',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
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

export const userMemoriesPreferences = pgTable(
  'user_memories_preferences',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    conclusionDirectives: text('conclusion_directives'),
    conclusionDirectivesVector: vector('conclusion_directives_vector', { dimensions: 1024 }),

    type: varchar255('type'),
    suggestions: text('suggestions'),

    scorePriority: numeric('score_priority', { mode: 'number' }).default(0),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_memories_preferences_conclusion_directives_vector_index').using(
      'hnsw',
      table.conclusionDirectivesVector.op('vector_cosine_ops'),
    ),
    index('user_memories_preferences_user_id_index').on(table.userId),
    index('user_memories_preferences_user_memory_id_index').on(table.userMemoryId),
  ],
);

export const userMemoriesActivities = pgTable(
  'user_memories_activities',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    type: varchar255('type').notNull(),
    status: varchar255('status').notNull().default('pending'),
    timezone: varchar255('timezone'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),

    associatedObjects: jsonb('associated_objects').$type<
      {
        extra?: Record<string, unknown>;
        name?: string;
        type?: string;
      }[]
    >(),
    associatedSubjects: jsonb('associated_subjects').$type<
      {
        extra?: Record<string, unknown>;
        name?: string;
        type?: string;
      }[]
    >(),
    associatedLocations: jsonb('associated_locations').$type<
      {
        address?: string;
        name?: string;
        tags?: string[];
        type?: string;
      }[]
    >(),

    notes: text('notes'),
    narrative: text('narrative'),
    narrativeVector: vector('narrative_vector', { dimensions: 1024 }),
    feedback: text('feedback'),
    feedbackVector: vector('feedback_vector', { dimensions: 1024 }),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_memories_activities_narrative_vector_index').using(
      'hnsw',
      table.narrativeVector.op('vector_cosine_ops'),
    ),
    index('user_memories_activities_feedback_vector_index').using(
      'hnsw',
      table.feedbackVector.op('vector_cosine_ops'),
    ),
    index('user_memories_activities_type_index').on(table.type),
    index('user_memories_activities_user_id_index').on(table.userId),
    index('user_memories_activities_user_memory_id_index').on(table.userMemoryId),
    index('user_memories_activities_status_index').on(table.status),
  ],
);

export const userMemoriesIdentities = pgTable(
  'user_memories_identities',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    type: varchar255('type'),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),
    episodicDate: timestamptz('episodic_date'),
    relationship: varchar255('relationship'),
    role: text('role'),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_memories_identities_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_identities_type_index').on(table.type),
    index('user_memories_identities_user_id_index').on(table.userId),
    index('user_memories_identities_user_memory_id_index').on(table.userMemoryId),
  ],
);

export const userMemoriesExperiences = pgTable(
  'user_memories_experiences',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    userMemoryId: varchar255('user_memory_id').references(() => userMemories.id, {
      onDelete: 'cascade',
    }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    tags: text('tags').array(),

    type: varchar255('type'),
    situation: text('situation'),
    situationVector: vector('situation_vector', { dimensions: 1024 }),
    reasoning: text('reasoning'),
    possibleOutcome: text('possible_outcome'),
    action: text('action'),
    actionVector: vector('action_vector', { dimensions: 1024 }),
    keyLearning: text('key_learning'),
    keyLearningVector: vector('key_learning_vector', { dimensions: 1024 }),

    scoreConfidence: real('score_confidence').default(0),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_memories_experiences_situation_vector_index').using(
      'hnsw',
      table.situationVector.op('vector_cosine_ops'),
    ),
    index('user_memories_experiences_action_vector_index').using(
      'hnsw',
      table.actionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_experiences_key_learning_vector_index').using(
      'hnsw',
      table.keyLearningVector.op('vector_cosine_ops'),
    ),
    index('user_memories_experiences_type_index').on(table.type),
    index('user_memories_experiences_user_id_index').on(table.userId),
    index('user_memories_experiences_user_memory_id_index').on(table.userMemoryId),
  ],
);

export type UserMemoryItem = typeof userMemories.$inferSelect;
export type UserMemoryItemWithoutVectors = Omit<
  UserMemoryItem,
  'summaryVector1024' | 'detailsVector1024'
>;
export type NewUserMemory = typeof userMemories.$inferInsert;

export type UserMemoryPreference = typeof userMemoriesPreferences.$inferSelect;
export type UserMemoryPreferencesWithoutVectors = Omit<
  UserMemoryPreference,
  'conclusionDirectivesVector'
>;
export type NewUserMemoryPreference = typeof userMemoriesPreferences.$inferInsert;

export type UserMemoryContext = typeof userMemoriesContexts.$inferSelect;
export type UserMemoryContextsWithoutVectors = Omit<
  UserMemoryContext,
  'titleVector' | 'descriptionVector'
>;
export type NewUserMemoryContext = typeof userMemoriesContexts.$inferInsert;

export type UserMemoryIdentity = typeof userMemoriesIdentities.$inferSelect;
export type UserMemoryIdentitiesWithoutVectors = Omit<UserMemoryIdentity, 'descriptionVector'>;
export type NewUserMemoryIdentity = typeof userMemoriesIdentities.$inferInsert;

export type UserMemoryExperience = typeof userMemoriesExperiences.$inferSelect;
export type UserMemoryExperiencesWithoutVectors = Omit<
  UserMemoryExperience,
  'situationVector' | 'actionVector' | 'keyLearningVector'
>;
export type NewUserMemoryExperience = typeof userMemoriesExperiences.$inferInsert;

export type UserMemoryActivity = typeof userMemoriesActivities.$inferSelect;
export type UserMemoryActivitiesWithoutVectors = Omit<
  UserMemoryActivity,
  'narrativeVector' | 'feedbackVector'
>;
export type NewUserMemoryActivity = typeof userMemoriesActivities.$inferInsert;

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

/**
 * A person, organization, product, repository or place the user deals with. The user is the
 * entity with `is_self`. Names, facts (identities) and preferences hang off entities. Like every
 * other memory it has a parent row in `user_memories`, so it is a node in `user_memories_edges`
 * (mentions, "not the same as", …).
 */
export const userMemoriesEntities = pgTable(
  'user_memories_entities',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),
    /** e.g. a fund under its firm, a subsidiary under its group. */
    parentEntityId: varchar255('parent_entity_id').references(
      (): AnyPgColumn => userMemoriesEntities.id,
      { onDelete: 'set null' },
    ),

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

    /** Canonical name; other names live in `user_memories_entity_names`. */
    name: text('name').notNull(),
    type: text('type').$type<UserMemoryEntityType>().notNull().default('other'),
    relationship: text('relationship'),
    role: text('role'),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),
    isSelf: boolean('is_self').notNull().default(false),

    /** Workspace visibility: personal memory stays `private`; agent / project memory may be `public`. */
    visibility: text('visibility').$type<UserMemoryVisibility>().notNull().default('private'),

    ...timestamps,
  },
  (table) => [
    index('user_memories_entities_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_entities_user_id_index').on(table.userId),
    index('user_memories_entities_parent_entity_id_index').on(table.parentEntityId),
    index('user_memories_entities_user_memory_id_index').on(table.userMemoryId),
    uniqueIndex('user_memories_entities_user_id_self_unique')
      .on(table.userId)
      .where(sql`${table.isSelf}`),
    index('user_memories_entities_workspace_visibility_idx').on(
      table.workspaceId,
      table.visibility,
      table.userId,
    ),
    index('user_memories_entities_agent_id_index').on(table.agentId),
    index('user_memories_entities_project_id_index').on(table.projectId),
  ],
);

/** Every name an entity goes by, including old names and names the user corrected away from. */
export const userMemoriesEntityNames = pgTable(
  'user_memories_entity_names',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    entityId: varchar255('entity_id')
      .references(() => userMemoriesEntities.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    name: text('name').notNull(),
    /** Lower-cased, whitespace-collapsed form used for exact resolution. */
    normalized: text('normalized').notNull(),
    kind: text('kind').$type<UserMemoryEntityNameKind>().notNull().default('alias'),
    /** The memory that stated this name. */
    sourceMemoryId: varchar255('source_memory_id').references(() => userMemories.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_memories_entity_names_entity_id_normalized_unique').on(
      table.entityId,
      table.normalized,
    ),
    index('user_memories_entity_names_user_id_normalized_index').on(table.userId, table.normalized),
    index('user_memories_entity_names_workspace_id_normalized_index').on(
      table.workspaceId,
      table.normalized,
    ),
  ],
);

/**
 * Many-to-many and graph relations between memories. Both ends are `user_memories` rows, so any
 * layer — context, dossier, activity, entity, preference, fact — can be a node, and deleting a
 * memory removes its edges. One-to-many backbone links stay as columns (dossier → context,
 * activity → dossier, fact → entity, preference → holder); edges carry what does not fit a column:
 * which memories mention an entity, which entities are stated not to be the same thing, which
 * memory supersedes or contradicts another. Symmetric relations are stored once, with the smaller
 * id as the source.
 */
export const userMemoriesEdges = pgTable(
  'user_memories_edges',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    sourceMemoryId: varchar255('source_memory_id')
      .references(() => userMemories.id, { onDelete: 'cascade' })
      .notNull(),
    targetMemoryId: varchar255('target_memory_id')
      .references(() => userMemories.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    relation: text('relation').$type<UserMemoryEdgeRelation>().notNull(),
    /** How many memories stated or implied this relation; raises confidence as it accumulates. */
    evidenceCount: integer('evidence_count').notNull().default(1),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_memories_edges_source_target_relation_unique').on(
      table.sourceMemoryId,
      table.targetMemoryId,
      table.relation,
    ),
    index('user_memories_edges_target_memory_id_relation_index').on(
      table.targetMemoryId,
      table.relation,
    ),
    index('user_memories_edges_user_id_relation_index').on(table.userId, table.relation),
    index('user_memories_edges_workspace_id_relation_index').on(table.workspaceId, table.relation),
  ],
);

/**
 * Every structural change the pipeline, the user or an agent makes to memory, with enough state to
 * undo it. Pending rows are the review queue: held for more evidence or waiting for the user.
 */
export const userMemoriesOperations = pgTable(
  'user_memories_operations',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    op: text('op').$type<UserMemoryOperationType>().notNull(),
    actor: text('actor').$type<UserMemoryOperationActor>().notNull(),
    /** Ids the operation touches, keyed by role (e.g. `{ dossier, activity }`). */
    targets: jsonb('targets').$type<Record<string, string | string[]>>().notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    confidence: real('confidence'),
    reason: text('reason'),
    gate: text('gate').$type<UserMemoryOperationGate>().notNull(),
    state: text('state').$type<UserMemoryOperationState>().notNull(),
    resolvedAt: timestamptz('resolved_at'),

    ...timestamps,
  },
  (table) => [
    index('user_memories_operations_user_id_state_created_at_index').on(
      table.userId,
      table.state,
      table.createdAt,
    ),
    index('user_memories_operations_workspace_id_state_created_at_index').on(
      table.workspaceId,
      table.state,
      table.createdAt,
    ),
  ],
);

export * from './persona';
