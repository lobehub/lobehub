/**
 * Entity kinds that support member-to-member ownership transfer. Polymorphic on
 * purpose (mirroring `resource_permissions`): onboarding a new entity only
 * requires a new literal here plus an accept-executor, not a new table.
 * v1 wires up `agent` and `agentGroup`; the remaining literals are reserved
 * for follow-up integrations.
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

/**
 * Reserved per-request options. The `options` jsonb column exists on the
 * request row, but nothing is currently stored in it — conversation-history
 * migration was deliberately dropped from member handover (a member's own
 * messages should not change author).
 */
export type ResourceTransferRequestOptions = Record<string, never>;
