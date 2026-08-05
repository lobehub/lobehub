import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** Display color as a CSS hex value, e.g. `#F5A623` */
    color: text('color'),

    /**
     * Archived labels can no longer be applied to agents, but existing
     * assignments stay untouched. Reversible, unlike delete.
     *
     * Archived rows are excluded from the name-uniqueness indexes below, so a
     * retired name becomes available again — which is the point of archiving.
     * The trade-off is that un-archiving is what can now collide: restoring a
     * label whose name has since been taken raises a unique violation, and the
     * caller must surface it as a rename prompt rather than a 500.
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
    // Names are the only thing distinguishing two labels in the grouped agents
    // list, so they are unique per scope — mirroring the sibling registry in
    // `agentSkills`. Split in two because the scope key differs: personal rows
    // key on the owner, workspace rows on the workspace (shared across members,
    // so two members cannot race the same name into one workspace).
    uniqueIndex('agent_labels_user_id_name_unique')
      .on(t.userId, t.name)
      .where(sql`${t.workspaceId} IS NULL AND ${t.archived} = false`),
    uniqueIndex('agent_labels_workspace_id_name_unique')
      .on(t.workspaceId, t.name)
      .where(sql`${t.workspaceId} IS NOT NULL AND ${t.archived} = false`),
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
    labelId: uuid('label_id')
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
