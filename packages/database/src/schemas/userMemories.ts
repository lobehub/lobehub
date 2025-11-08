/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { bigint, index, jsonb, numeric, pgTable, real, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from './_helpers';
import { users } from './user';

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
    metadata: jsonb('metadata'),
    tags: text('tags').array(),

    title: varchar255('title'),
    summary: text('summary'),
    summaryVector1024: vector('summary_vector_1024', { dimensions: 1024 }),
    details: text('details'),
    detailsVector1024: vector('details_vector_1024', { dimensions: 1024 }),

    status: varchar255('status'),

    accessedCount: bigint('accessed_count', { mode: 'number' }).default(0),
    lastAccessedAt: timestamptz('last_accessed_at').notNull(),

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
  ],
);

export const userMemoriesContexts = pgTable(
  'user_memories_contexts',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('memory'))
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    userMemoryIds: jsonb('user_memory_ids'),

    metadata: jsonb('metadata'),
    tags: text('tags').array(),

    associatedObjects: jsonb('associated_objects'),
    associatedSubjects: jsonb('associated_subjects'),

    title: text('title'),
    titleVector: vector('title_vector', { dimensions: 1024 }),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),

    type: varchar255('type'),
    currentStatus: text('current_status'),

    scoreImpact: numeric('score_impact', { mode: 'number' }).default(0),
    scoreUrgency: numeric('score_urgency', { mode: 'number' }).default(0),

    ...timestamps,
  },
  (table) => [
    index('user_memories_contexts_title_vector_index').using(
      'hnsw',
      table.titleVector.op('vector_cosine_ops'),
    ),
    index('user_memories_contexts_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_contexts_type_index').on(table.type),
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

    metadata: jsonb('metadata'),
    tags: text('tags').array(),

    conclusionDirectives: text('conclusion_directives'),
    conclusionDirectivesVector: vector('conclusion_directives_vector', { dimensions: 1024 }),

    type: varchar255('type'),
    suggestions: text('suggestions'),

    scorePriority: numeric('score_priority', { mode: 'number' }).default(0),

    ...timestamps,
  },
  (table) => [
    index('user_memories_preferences_conclusion_directives_vector_index').using(
      'hnsw',
      table.conclusionDirectivesVector.op('vector_cosine_ops'),
    ),
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

    metadata: jsonb('metadata'),
    tags: text('tags').array(),

    type: varchar255('type'),
    description: text('description'),
    descriptionVector: vector('description_vector', { dimensions: 1024 }),
    episodicDate: timestamptz('episodic_date'),
    relationship: varchar255('relationship'),
    role: text('role'),

    ...timestamps,
  },
  (table) => [
    index('user_memories_identities_description_vector_index').using(
      'hnsw',
      table.descriptionVector.op('vector_cosine_ops'),
    ),
    index('user_memories_identities_type_index').on(table.type),
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

    metadata: jsonb('metadata'),
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
  ],
);

export type UserMemoryItem = typeof userMemories.$inferSelect;
export type NewUserMemory = typeof userMemories.$inferInsert;

export type UserMemoryPreference = typeof userMemoriesPreferences.$inferSelect;
export type NewUserMemoryPreference = typeof userMemoriesPreferences.$inferInsert;

export type UserMemoryContext = typeof userMemoriesContexts.$inferSelect;
export type NewUserMemoryContext = typeof userMemoriesContexts.$inferInsert;

export type UserMemoryIdentity = typeof userMemoriesIdentities.$inferSelect;
export type NewUserMemoryIdentity = typeof userMemoriesIdentities.$inferInsert;

export type UserMemoryExperience = typeof userMemoriesExperiences.$inferSelect;
export type NewUserMemoryExperience = typeof userMemoriesExperiences.$inferInsert;
