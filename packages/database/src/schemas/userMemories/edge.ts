import type { UserMemoryEdgeRelation } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, varchar255 } from '../_helpers';
import { users } from '../user';
import { workspaces } from '../workspace';
import { userMemories } from './base';

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
