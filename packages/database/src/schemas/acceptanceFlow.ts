import type { AcceptanceFlowNodeOverrides } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { acceptances, verifyCriteria } from './verify';

export const acceptanceFlows = pgTable(
  'acceptance_flows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    acceptanceId: uuid('acceptance_id')
      .notNull()
      .references(() => acceptances.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ...timestamps,
  },
  (t) => [index('acceptance_flows_acceptance_idx').on(t.acceptanceId)],
);

/** A check asset's position in a graph, independent of any execution round. */
export const acceptanceFlowNodes = pgTable(
  'acceptance_flow_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => acceptanceFlows.id, { onDelete: 'cascade' }),
    /** Migration defers this FK to commit so account/workspace cascades can remove the graph too. */
    criterionId: uuid('criterion_id').references(() => verifyCriteria.id, {
      onDelete: 'no action',
    }),
    /** A subflow occurrence; check results remain scoped to this graph position. */
    subFlowId: uuid('sub_flow_id').references(() => acceptanceFlows.id, { onDelete: 'no action' }),
    isEntry: boolean('is_entry').notNull().default(false),
    overrides: jsonb('overrides').$type<AcceptanceFlowNodeOverrides>(),
  },
  (t) => [
    check(
      'acceptance_flow_nodes_target_check',
      sql`num_nonnulls(${t.criterionId}, ${t.subFlowId}) = 1`,
    ),
    index('acceptance_flow_nodes_sub_flow_idx').on(t.subFlowId),
    uniqueIndex('acceptance_flow_nodes_flow_id_unique').on(t.flowId, t.id),
    uniqueIndex('acceptance_flow_nodes_entry_unique')
      .on(t.flowId)
      .where(sql`${t.isEntry} = true`),
    index('acceptance_flow_nodes_criterion_idx').on(t.criterionId),
  ],
);
export const acceptanceFlowEdges = pgTable(
  'acceptance_flow_edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => acceptanceFlows.id, { onDelete: 'cascade' }),
    sourceNodeId: uuid('source_node_id').notNull(),
    targetNodeId: uuid('target_node_id').notNull(),
    trigger: text('trigger').notNull(),
    condition: text('condition'),
    required: boolean('required').notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.flowId, t.sourceNodeId],
      foreignColumns: [acceptanceFlowNodes.flowId, acceptanceFlowNodes.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.flowId, t.targetNodeId],
      foreignColumns: [acceptanceFlowNodes.flowId, acceptanceFlowNodes.id],
    }).onDelete('cascade'),
    index('acceptance_flow_edges_source_idx').on(t.flowId, t.sourceNodeId),
    index('acceptance_flow_edges_target_idx').on(t.flowId, t.targetNodeId),
  ],
);
