import type {
  InboundWebhookConfig,
  InboundWebhookError,
  InboundWebhookKind,
  InboundWebhookState,
  InboundWebhookStatus,
  InboundWebhookVerification,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { userConnectors } from './connector';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/** An authenticated inbound endpoint; kind owns its subscription protocol. */
export const inboundWebhooks = pgTable(
  'inbound_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<InboundWebhookKind>().notNull(),
    name: text('name'),
    status: text('status').$type<InboundWebhookStatus>().notNull().default('pending'),
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    instructions: text('instructions'),
    /** KeyVaults ciphertext, deliberately excluded from model read shapes. */
    secret: text('secret'),
    verification: jsonb('verification').$type<InboundWebhookVerification>().notNull(),
    config: jsonb('config').$type<InboundWebhookConfig>().notNull(),
    state: jsonb('state').$type<InboundWebhookState>().notNull().default({}),
    connectorId: uuid('connector_id').references(() => userConnectors.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key'),
    nextMaintenanceAt: timestamptz('next_maintenance_at'),
    maintenanceFailures: integer('maintenance_failures').notNull().default(0),
    lastDeliveryAt: timestamptz('last_delivery_at'),
    lastError: text('last_error').$type<InboundWebhookError>(),
    wakeCount: integer('wake_count').notNull().default(0),
    wakeWindowStartedAt: timestamptz('wake_window_started_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('inbound_webhooks_user_kind_dedupe_unique')
      .on(t.userId, t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    index('inbound_webhooks_next_maintenance_idx')
      .on(t.nextMaintenanceAt)
      .where(sql`${t.nextMaintenanceAt} IS NOT NULL`),
    index('inbound_webhooks_user_idx').on(t.userId),
    index('inbound_webhooks_workspace_idx').on(t.workspaceId),
    index('inbound_webhooks_topic_idx').on(t.topicId),
    index('inbound_webhooks_agent_idx').on(t.agentId),
    index('inbound_webhooks_connector_idx').on(t.connectorId),
  ],
);

export type InboundWebhookRow = typeof inboundWebhooks.$inferSelect;
export type NewInboundWebhook = typeof inboundWebhooks.$inferInsert;
