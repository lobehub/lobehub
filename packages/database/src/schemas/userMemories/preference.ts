import type { UserMemoryEvidenceSource } from '@lobechat/types';
import { index, integer, jsonb, numeric, pgTable, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';
import { userMemories } from './base';
import { userMemoriesEntities } from './entity';

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

    /** Whose preference this is; null means the user (rows from before entities existed). */
    holderEntityId: varchar255('holder_entity_id').references(() => userMemoriesEntities.id, {
      onDelete: 'set null',
    }),
    /** Set when the rule only applies when this entity is involved. */
    appliesToEntityId: varchar255('applies_to_entity_id').references(
      () => userMemoriesEntities.id,
      { onDelete: 'set null' },
    ),
    /** Situation the preference applies to, e.g. weekly reports or investor updates. */
    scope: text('scope'),
    evidenceSource: text('evidence_source').$type<UserMemoryEvidenceSource>(),
    evidenceCount: integer('evidence_count').notNull().default(1),
    lastEvidenceAt: timestamptz('last_evidence_at'),

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
    index('user_memories_preferences_holder_entity_id_index').on(table.holderEntityId),
    index('user_memories_preferences_applies_to_entity_id_index').on(table.appliesToEntityId),
  ],
);

export type UserMemoryPreference = typeof userMemoriesPreferences.$inferSelect;
export type UserMemoryPreferencesWithoutVectors = Omit<
  UserMemoryPreference,
  'conclusionDirectivesVector'
>;
export type NewUserMemoryPreference = typeof userMemoriesPreferences.$inferInsert;
