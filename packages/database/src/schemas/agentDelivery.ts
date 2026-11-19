import type {
  AgentDeliveryFriction,
  AgentDeliveryOutcome,
  AgentDeliveryOutcomeSource,
  AgentDeliverySubjectType,
  AgentDeliveryWorkRole,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { amountNumeric, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { channels } from './channel';
import { projects } from './project';
import { tasks } from './task';
import { users } from './user';
import { works, workVersions } from './work';
import { workspaces } from './workspace';

/**
 * An Agent's track record, one row per delivery — like an order on a ride-hailing
 * app: someone asked for something, the Agent took it on and handed back a result,
 * and the requester's verdict (stated or inferred) closes the loop.
 *
 * A row is settled when its carrier is archived (topic, channel thread, task) and
 * is overwritten — never duplicated — if the carrier is reopened and archived
 * again. Several Agents working in one thread each get their own row.
 *
 * Rows are the raw material the Agent's profile stats are read from and that
 * skills and Expertise lessons are later distilled out of.
 */
export const agentDeliveries = pgTable(
  'agent_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The carrier this delivery settled on. Polymorphic, so `subjectId` carries no FK. */
    subjectType: text('subject_type').$type<AgentDeliverySubjectType>().notNull(),
    subjectId: text('subject_id').notNull(),
    /** The container delivery (e.g. a task's) this atomic delivery rolls up into. */
    parentDeliveryId: uuid('parent_delivery_id').references((): AnyPgColumn => agentDeliveries.id, {
      onDelete: 'set null',
    }),

    /** Who asked for it; outcomes are read per requester since standards differ. */
    requesterUserId: text('requester_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    channelId: text('channel_id').references(() => channels.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),

    title: text('title'),
    summary: text('summary'),
    /** Same taxonomy as `topic_analyses.category`, so both read on one axis. */
    category: text('category'),

    outcome: text('outcome').$type<AgentDeliveryOutcome>().default('unknown').notNull(),
    outcomeSource: text('outcome_source').$type<AgentDeliveryOutcomeSource>(),
    /** 0–1. */
    outcomeConfidence: real('outcome_confidence'),

    /**
     * Rounds of back-and-forth after the Agent's first hand-off. At most
     * `AGENT_DELIVERY_SMOOTH_MAX_SHOTS` counts as smooth: some rounds are only a
     * confirmation or a small touch-up.
     */
    shots: integer('shots'),
    frictions: jsonb('frictions').$type<AgentDeliveryFriction[]>(),

    /** Total spend in USD across the delivery's runs. */
    totalCost: amountNumeric('total_cost'),
    totalTokens: integer('total_tokens'),
    toolCalls: integer('tool_calls'),
    userMessages: integer('user_messages'),
    agentMessages: integer('agent_messages'),
    durationMs: integer('duration_ms'),

    startedAt: timestamptz('started_at'),
    deliveredAt: timestamptz('delivered_at'),
    /** When the carrier was archived and the delivery judged. */
    settledAt: timestamptz('settled_at'),
    /** Set once the delivery has been distilled into skills / Expertise. */
    distilledAt: timestamptz('distilled_at'),

    /** How the analysis was produced and what it cited (prompt version, evidence message ids). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_deliveries_subject_agent_unique').on(t.subjectType, t.subjectId, t.agentId),
    index('agent_deliveries_agent_id_settled_at_idx').on(t.agentId, t.settledAt),
    index('agent_deliveries_user_id_settled_at_idx').on(t.userId, t.settledAt),
    index('agent_deliveries_workspace_id_settled_at_idx')
      .on(t.workspaceId, t.settledAt)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    index('agent_deliveries_parent_delivery_id_idx')
      .on(t.parentDeliveryId)
      .where(sql`${t.parentDeliveryId} IS NOT NULL`),
    index('agent_deliveries_project_id_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    index('agent_deliveries_task_id_idx')
      .on(t.taskId)
      .where(sql`${t.taskId} IS NOT NULL`),
  ],
);

export type AgentDeliveryItem = typeof agentDeliveries.$inferSelect;
export type NewAgentDelivery = typeof agentDeliveries.$inferInsert;

/**
 * Works a delivery produced or touched. Many-to-many: one delivery can ship
 * several Works, and one Work can be revised across several deliveries.
 */
export const agentDeliveryWorks = pgTable(
  'agent_delivery_works',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    deliveryId: uuid('delivery_id')
      .references(() => agentDeliveries.id, { onDelete: 'cascade' })
      .notNull(),
    workId: text('work_id')
      .references(() => works.id, { onDelete: 'cascade' })
      .notNull(),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    role: text('role').$type<AgentDeliveryWorkRole>().notNull(),
    /** The Work's version when the delivery settled. */
    workVersionId: uuid('work_version_id').references(() => workVersions.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_delivery_works_delivery_id_work_id_unique').on(t.deliveryId, t.workId),
    index('agent_delivery_works_work_id_idx').on(t.workId),
    index('agent_delivery_works_workspace_id_idx')
      .on(t.workspaceId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export type AgentDeliveryWorkItem = typeof agentDeliveryWorks.$inferSelect;
export type NewAgentDeliveryWork = typeof agentDeliveryWorks.$inferInsert;
