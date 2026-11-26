import type { ContextReplaySnapshot } from '@lobechat/types';
import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { messages } from './message';
import { users } from './user';
import { workspaces } from './workspace';

/** Private model input. Kept out of message DTOs, exports and public shares. */
export const messageContextSnapshots = pgTable(
  'message_context_snapshots',
  {
    messageId: text('message_id')
      .primaryKey()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').$type<ContextReplaySnapshot>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('message_context_snapshots_user_id_idx').on(t.userId),
    index('message_context_snapshots_workspace_id_idx').on(t.workspaceId),
  ],
);
