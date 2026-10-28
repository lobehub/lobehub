import { boolean, index, jsonb, pgTable, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';
import { userMemories } from './base';
import { userMemoriesDossiers } from './context';

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

    /** The dossier this activity is evidence for. Activities are not edited after they are written. */
    dossierId: varchar255('dossier_id').references(() => userMemoriesDossiers.id, {
      onDelete: 'set null',
    }),
    /** False for evidence that should never be injected on its own (cron run logs, one-off Q&A). */
    injectable: boolean('injectable').notNull().default(true),

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
