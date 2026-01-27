/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createNanoId } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';

// TODO(@nekomeowww): add a comment/annotation layer for personas.
// Rationale: the persona writer often wants to flag clarifications or open questions (e.g. “need team name”, “confirm Apple Developer plan”)
// without polluting the readable persona text. A small JSONB comments array here (section + target hash + message + type) would let us
// persist those notes, render inline highlights in the UI, and feed precise prompts back into the next persona write. This keeps the
// narrative clean, improves user engagement (they see exactly what to answer), and gives us structured signals for future updates.

export const userPersonaDocuments = pgTable(
  'user_memory_persona_documents',
  {
    id: varchar255('id')
      .$defaultFn(() => createNanoId(18)())
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    profile: varchar255('profile').default('default').notNull(),

    tagline: text('tagline'),
    persona: text('persona'),

    memoryIds: jsonb('memory_ids').$type<string[]>(),
    sourceIds: jsonb('source_ids').$type<string[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    version: integer('version').notNull().default(1),
    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_persona_documents_user_id_profile_unique').on(table.userId, table.profile),
    index('user_persona_documents_user_id_index').on(table.userId),
  ],
);

export const userPersonaDocumentHistories = pgTable(
  'user_memory_persona_document_histories',
  {
    id: varchar255('id')
      .$defaultFn(() => createNanoId(18)())
      .primaryKey(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    personaId: varchar255('persona_id').references(() => userPersonaDocuments.id, {
      onDelete: 'cascade',
    }),
    profile: varchar255('profile').default('default').notNull(),

    snapshotPersona: text('snapshot_persona'),
    snapshotTagline: text('snapshot_tagline'),
    reasoning: text('reasoning'),
    diffPersona: text('diff_persona'),
    diffTagline: text('diff_tagline'),
    snapshot: text('snapshot'),
    summary: text('summary'),
    editedBy: varchar255('edited_by').default('agent'),

    memoryIds: jsonb('memory_ids').$type<string[]>(),
    sourceIds: jsonb('source_ids').$type<string[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    previousVersion: integer('previous_version'),
    nextVersion: integer('next_version'),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('user_persona_document_histories_persona_id_index').on(table.personaId),
    index('user_persona_document_histories_user_id_index').on(table.userId),
    index('user_persona_document_histories_profile_index').on(table.profile),
  ],
);

export type UserPersonaDocument = typeof userPersonaDocuments.$inferSelect;
export type NewUserPersonaDocument = typeof userPersonaDocuments.$inferInsert;

export type UserPersonaDocumentHistoriesItem = typeof userPersonaDocumentHistories.$inferSelect;
export type NewUserPersonaDocumentHistoriesItem = typeof userPersonaDocumentHistories.$inferInsert;
