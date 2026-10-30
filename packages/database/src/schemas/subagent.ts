import { relations } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { agents } from './agent';

/**
 * Subagent presets owned by a parent agent. Kept out of `agents` on purpose so
 * presets can never leak into agent lists, the market or share flows, and so
 * the table only carries the fields a preset uses. See `SubagentItem`.
 *
 * Deliberately has no owner columns: access derives from the parent agent, so
 * presets follow it through ownership handovers and cross-scope transfers.
 */
export const subagents = pgTable(
  'subagents',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('subagents'))
      .primaryKey(),
    parentAgentId: text('parent_agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),

    name: text('name').notNull(),
    description: text('description'),
    systemRole: text('system_role'),

    // A single model choice per preset; no multi-model routing.
    model: text('model'),
    provider: text('provider'),
    reasoningEffort: text('reasoning_effort'),

    /** Allowed tool identifiers; `null` inherits the parent agent's tools. */
    tools: jsonb('tools').$type<string[] | null>(),
    isEnabled: boolean('is_enabled').default(true).notNull(),

    ...timestamps,
  },
  (t) => [
    index('subagents_parent_agent_id_idx').on(t.parentAgentId),
    uniqueIndex('subagents_parent_agent_id_name_unique').on(t.parentAgentId, t.name),
  ],
);

export const subagentsRelations = relations(subagents, ({ one }) => ({
  parentAgent: one(agents, {
    fields: [subagents.parentAgentId],
    references: [agents.id],
  }),
}));

export const insertSubagentSchema = createInsertSchema(subagents);

export type NewSubagent = typeof subagents.$inferInsert;
export type SubagentRow = typeof subagents.$inferSelect;
