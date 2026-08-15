import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Entity kinds that support member-to-member ownership transfer. Polymorphic on
 * purpose (mirroring `resource_permissions`): onboarding a new entity only
 * requires a new literal here plus an accept-executor, not a new table.
 * v1 wires up `agent` only; the remaining literals are reserved for the
 * follow-up integrations.
 */
export const TRANSFER_RESOURCE_TYPES = [
  'agent',
  'agentGroup',
  'document',
  'file',
  'knowledgeBase',
] as const;
export type TransferResourceType = (typeof TRANSFER_RESOURCE_TYPES)[number];

/**
 * Lifecycle of a transfer request. `pending` is the only live state; every
 * other state is terminal:
 * - `accepted`  — recipient confirmed, ownership has been handed over
 * - `declined`  — recipient refused
 * - `cancelled` — initiator withdrew, or the resource left the workspace /
 *                 was deleted before the recipient answered
 * - `expired`   — nobody acted before `expiresAt` (stamped lazily on read)
 */
export const RESOURCE_TRANSFER_REQUEST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
] as const;
export type ResourceTransferRequestStatus = (typeof RESOURCE_TRANSFER_REQUEST_STATUSES)[number];

export interface ResourceTransferRequestOptions {
  /**
   * Hand the initiator's own topics/messages of this resource to the recipient
   * on accept. Only the resource creator may set it (a primary owner
   * reassigning someone else's resource cannot give away conversations that
   * are not theirs).
   */
  migrateSessions?: boolean;
}

/**
 * Member-to-member ownership handover requests inside one workspace, gated on
 * the recipient's confirmation. One row per initiated transfer; the resource's
 * ownership column (`agents.userId`, …) only changes when the recipient
 * accepts.
 */
export const resourceTransferRequests = pgTable(
  'resource_transfer_requests',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    resourceType: text('resource_type', { enum: TRANSFER_RESOURCE_TYPES }).notNull(),
    resourceId: text('resource_id').notNull(),

    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    /** Who initiated the transfer: the resource creator, or the workspace primary owner reassigning it. */
    initiatorId: text('initiator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** The member who must accept before ownership changes. */
    recipientId: text('recipient_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * The resource owner at request time. Equals `initiatorId` for a creator
     * transfer; differs when the primary owner reassigns another member's
     * resource (that member gets the courtesy notification on accept).
     */
    previousOwnerId: text('previous_owner_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    status: text('status', { enum: RESOURCE_TRANSFER_REQUEST_STATUSES })
      .notNull()
      .default('pending'),

    options: jsonb('options').$type<ResourceTransferRequestOptions>(),

    /** After this instant a still-pending request can no longer be accepted; reads lazily stamp it `expired`. */
    expiresAt: timestamptz('expires_at').notNull(),

    /** When the request left `pending` (accept/decline/cancel/expire). */
    resolvedAt: timestamptz('resolved_at'),

    ...timestamps,
  },
  (t) => [
    // One live request per resource: the arbiter for the "concurrent second
    // transfer" race. Terminal rows stay for audit without blocking new ones.
    uniqueIndex('resource_transfer_requests_pending_resource_unique')
      .on(t.resourceType, t.resourceId)
      .where(sql`${t.status} = 'pending'`),
    index('resource_transfer_requests_recipient_idx').on(t.recipientId, t.status),
    index('resource_transfer_requests_workspace_idx').on(t.workspaceId),
  ],
);

export type NewResourceTransferRequest = typeof resourceTransferRequests.$inferInsert;
export type ResourceTransferRequestItem = typeof resourceTransferRequests.$inferSelect;
