import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt, varchar255 } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The durable CAS ledger for a Yjs collaboration room.
 *
 * It is intentionally separate from both document metadata and rewrite
 * requests. A room revision/state vector is an infrastructure version, not a
 * user-authored document property or request lifecycle field.
 */
export const documentCollaborationStates = pgTable(
  'document_collaboration_states',
  {
    documentId: varchar255('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    roomId: varchar255('room_id').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roomRevision: integer('room_revision').default(0).notNull(),
    stateVector: text('state_vector').default('').notNull(),
    /** Full immutable Yjs snapshot, base64 encoded. Null only for pre-migration rows. */
    snapshotUpdate: text('snapshot_update'),
    /** Opaque optimistic-concurrency token, rotated on every successful CAS. */
    versionToken: varchar255('version_token').notNull(),
    /** The document row timestamp observed by the successful room write. */
    documentUpdatedAt: timestamptz('document_updated_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('document_collaboration_states_room_id_idx').on(table.roomId),
    index('document_collaboration_states_workspace_id_idx').on(table.workspaceId),
    index('document_collaboration_states_user_id_idx').on(table.userId),
  ],
);

export type DocumentCollaborationStateItem = typeof documentCollaborationStates.$inferSelect;
export type NewDocumentCollaborationState = typeof documentCollaborationStates.$inferInsert;
