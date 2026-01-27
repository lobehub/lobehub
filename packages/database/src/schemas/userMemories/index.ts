/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { bigint, index, jsonb, numeric, pgTable, real, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';

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

export * from './persona';
