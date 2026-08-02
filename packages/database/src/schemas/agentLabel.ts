import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Agent labels - a workspace-level (or personal) label registry used to tag
 * agents in the sidebar / agents list and group the list by label. Labels are
 * shared with every workspace member; in personal mode (`workspace_id IS NULL`)
 * they belong to a single user.
 */
export const agentLabels = pgTable(
  'agent_labels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agentLabels'))
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Display color as a CSS hex value, e.g. `#F5A623` */
    color: text('color'),

    /**
     * Archived labels can no longer be applied to agents, but existing
     * assignments stay untouched. Reversible, unlike delete.
     */
    archived: boolean('archived').default(false).notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    index('agent_labels_user_id_idx').on(t.userId),
    index('agent_labels_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentLabel = typeof agentLabels.$inferInsert;
export type AgentLabelItem = typeof agentLabels.$inferSelect;

/**
 * Assignment rows connecting agent labels with agents. An agent can carry any
 * number of labels; the label assignment is shared with the whole workspace.
 */
export const agentLabelAssignments = pgTable(
  'agent_label_assignments',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    labelId: text('label_id')
      .references(() => agentLabels.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_label_assignments_label_id_agent_id_unique').on(t.labelId, t.agentId),
    index('agent_label_assignments_agent_id_idx').on(t.agentId),
    index('agent_label_assignments_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentLabelAssignment = typeof agentLabelAssignments.$inferInsert;
export type AgentLabelAssignmentItem = typeof agentLabelAssignments.$inferSelect;
