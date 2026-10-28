import { index, jsonb, pgTable, text, vector } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';
import { userMemories } from './base';
import { userMemoriesEntities } from './entity';

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

    /** The entity this fact is about; null for rows from before entities existed. */
    entityId: varchar255('entity_id').references(() => userMemoriesEntities.id, {
      onDelete: 'set null',
    }),

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
