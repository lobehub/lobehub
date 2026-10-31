import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Public appreciation on Workspace agents (the badge-wall heart). One row per
 * (agent, user); the row disappears when the like is withdrawn. `workspace_id`
 * records where the like was given: summaries only count rows matching the
 * agent's current workspace, so likes from before a transfer stop counting
 * without the transfer having to touch this table.
 */
export const agentLikes = pgTable(
  'agent_likes',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_likes_agent_id_user_id_unique').on(t.agentId, t.userId),
    index('agent_likes_user_id_idx').on(t.userId),
    index('agent_likes_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentLike = typeof agentLikes.$inferInsert;
export type AgentLikeItem = typeof agentLikes.$inferSelect;
