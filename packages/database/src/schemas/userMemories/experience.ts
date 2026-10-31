import { index, jsonb, pgTable, real, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';
import { userMemories } from './base';

/**
 * @deprecated Superseded by the structured model: what happened is an activity under a dossier,
 * a durable lesson is a preference or an entity fact. Kept for existing rows and readers; do not
 * write new experiences.
 */
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
