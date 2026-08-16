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
