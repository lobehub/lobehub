import type {
  UserMemoryOperationActor,
  UserMemoryOperationGate,
  UserMemoryOperationState,
  UserMemoryOperationType,
} from '@lobechat/types';
import { index, jsonb, pgTable, real, text } from 'drizzle-orm/pg-core';

import { idGenerator } from '../../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from '../_helpers';
import { users } from '../user';
import { workspaces } from '../workspace';

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
