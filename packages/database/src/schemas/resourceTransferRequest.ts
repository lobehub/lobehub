import type {
  ResourceTransferRequestOptions,
  ResourceTransferRequestStatus,
  TransferResourceType,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Member-to-member ownership handover requests inside one workspace, gated on
 * the recipient's confirmation. One row per initiated transfer; the resource's
 * ownership column (`agents.userId`, …) only changes when the recipient
 * accepts.
 *
 * `resourceType` / `status` are plain text columns typed via `@lobechat/types`
 * unions — no DB-level enum, so onboarding a new resource kind or state never
 * needs a migration.
 */
export const resourceTransferRequests = pgTable(
  'resource_transfer_requests',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    resourceType: text('resource_type').$type<TransferResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),

    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Who initiated the transfer: the resource creator, or the workspace
     * primary owner reassigning it. Null once that account is deleted —
     * terminal rows are the audit trail of the handover, so actor references
     * degrade to null instead of cascading the row away.
     */
    initiatorId: text('initiator_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * The member who must accept before ownership changes. Null once that
     * account is deleted; a still-pending row with a null recipient can no
     * longer be accepted and is treated as cancelled/expired by reads.
     */
    recipientId: text('recipient_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * The resource owner at request time. Equals `initiatorId` for a creator
     * transfer; differs when the primary owner reassigns another member's
     * resource (that member gets the courtesy notification on accept).
     */
    previousOwnerId: text('previous_owner_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    status: text('status').$type<ResourceTransferRequestStatus>().notNull().default('pending'),

    options: jsonb('options').$type<ResourceTransferRequestOptions>(),

    /** After this instant a still-pending request can no longer be accepted; reads lazily stamp it `expired`. */
    expiresAt: timestamptz('expires_at').notNull(),

    /** When the request left `pending` (accept/decline/cancel/expire). */
    resolvedAt: timestamptz('resolved_at'),

    ...timestamps,
  },
  (t) => [
    // One live request per resource: the arbiter for the "concurrent second
    // transfer" race. Terminal rows stay for audit without blocking new ones,
    // and a pending row orphaned by recipient deletion (recipient_id nulled by
    // the FK) is no longer acceptable, so it must not block a replacement either.
    uniqueIndex('resource_transfer_requests_pending_resource_unique')
      .on(t.resourceType, t.resourceId)
      .where(sql`${t.status} = 'pending' AND ${t.recipientId} IS NOT NULL`),
    index('resource_transfer_requests_recipient_idx').on(t.recipientId, t.status),
    index('resource_transfer_requests_workspace_idx').on(t.workspaceId),
  ],
);

export type NewResourceTransferRequest = typeof resourceTransferRequests.$inferInsert;
export type ResourceTransferRequestItem = typeof resourceTransferRequests.$inferSelect;
