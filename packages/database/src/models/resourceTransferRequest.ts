import type { TransferResourceType } from '@lobechat/types';
import { and, desc, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';

import type { ResourceTransferRequestItem } from '../schemas';
import { notifications, resourceTransferRequests } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/** Create rejected: the resource already carries a live transfer request. */
export const TRANSFER_REQUEST_ALREADY_PENDING = 'TRANSFER_REQUEST_ALREADY_PENDING';
/** Accept/decline/cancel rejected: no live request matched the caller. */
export const TRANSFER_REQUEST_NOT_PENDING = 'TRANSFER_REQUEST_NOT_PENDING';
/** Accept rejected: the request outlived its `expiresAt`. */
export const TRANSFER_REQUEST_EXPIRED = 'TRANSFER_REQUEST_EXPIRED';

export const TRANSFER_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound for a user's pending-transfer listing (inbox drawer renders all rows it gets). */
export const PENDING_TRANSFER_LIST_LIMIT = 50;

type Executor = Transaction | LobeChatDatabase;

const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (('code' in error && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) ||
    ('cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)));

/**
 * Lifecycle of member-to-member ownership handover requests, scoped to one
 * workspace. Pure request-state machine: the actual ownership rewrite on
 * accept belongs to the resource's own model and runs in the same transaction
 * the caller passes in.
 *
 * Expiry is lazy: nothing sweeps the table. A pending row past `expiresAt` is
 * stamped `expired` by whichever read or transition touches it first, and is
 * treated as terminal either way.
 */
export class ResourceTransferRequestModel {
  private db: LobeChatDatabase;
  private workspaceId: string;

  constructor(db: LobeChatDatabase, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  create = async (params: {
    initiatorId: string;
    previousOwnerId?: string | null;
    recipientId: string;
    resourceId: string;
    resourceType: TransferResourceType;
  }): Promise<ResourceTransferRequestItem> => {
    // A stale pending row past its TTL must not block a new request — the
    // partial unique index only sees `status`, so expire it first.
    await this.expireOverdue(params.resourceType, params.resourceId);

    try {
      const [row] = await this.db
        .insert(resourceTransferRequests)
        .values({
          expiresAt: new Date(Date.now() + TRANSFER_REQUEST_TTL_MS),
          initiatorId: params.initiatorId,
          previousOwnerId: params.previousOwnerId ?? params.initiatorId,
          recipientId: params.recipientId,
          resourceId: params.resourceId,
          resourceType: params.resourceType,
          workspaceId: this.workspaceId,
        })
        .returning();
      return row;
    } catch (error) {
      // The partial unique index is the arbiter for two concurrent initiations.
      if (isUniqueViolation(error))
        throw new Error(TRANSFER_REQUEST_ALREADY_PENDING, { cause: error });
      throw error;
    }
  };

  findById = async (id: string): Promise<ResourceTransferRequestItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(resourceTransferRequests)
      .where(
        and(
          eq(resourceTransferRequests.id, id),
          eq(resourceTransferRequests.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);

    return row && (await this.withLazyExpiry(row));
  };

  /** The live request of one resource, if any. */
  findPendingByResource = async (
    resourceType: TransferResourceType,
    resourceId: string,
  ): Promise<ResourceTransferRequestItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(resourceTransferRequests)
      .where(this.pendingResourceMatch(resourceType, resourceId))
      .limit(1);

    if (!row) return undefined;
    const resolved = await this.withLazyExpiry(row);
    return resolved.status === 'pending' ? resolved : undefined;
  };

  /**
   * Live requests the user must answer (recipient) or may withdraw
   * (initiator). Newest-first and capped: the inbox drawer renders every row
   * it receives, so an unbounded result would balloon both the enrichment
   * fan-out and the DOM for a user involved in many transfers.
   */
  listPendingForUser = async (userId: string): Promise<ResourceTransferRequestItem[]> => {
    const rows = await this.db
      .select()
      .from(resourceTransferRequests)
      .where(
        and(
          eq(resourceTransferRequests.workspaceId, this.workspaceId),
          eq(resourceTransferRequests.status, 'pending'),
          // Orphaned rows (recipient account deleted → recipient_id nulled)
          // are dead: nobody can accept them, so don't show them.
          isNotNull(resourceTransferRequests.recipientId),
          or(
            eq(resourceTransferRequests.recipientId, userId),
            eq(resourceTransferRequests.initiatorId, userId),
          ),
        ),
      )
      .orderBy(desc(resourceTransferRequests.createdAt))
      .limit(PENDING_TRANSFER_LIST_LIMIT);

    const resolved = await Promise.all(rows.map((row) => this.withLazyExpiry(row)));
    return resolved.filter((row) => row.status === 'pending');
  };

  /**
   * Recipient accepts. Flips `pending → accepted` with a conditional UPDATE so
   * a concurrent decline/cancel/second-accept loses cleanly. Run inside the
   * caller's transaction together with the ownership rewrite (pass `trx`).
   */
  accept = async (
    id: string,
    recipientId: string,
    trx?: Executor,
  ): Promise<ResourceTransferRequestItem> =>
    this.transition(id, 'accepted', eq(resourceTransferRequests.recipientId, recipientId), trx);

  /** Recipient refuses; the resource stays untouched. */
  decline = async (id: string, recipientId: string): Promise<ResourceTransferRequestItem> =>
    this.transition(id, 'declined', eq(resourceTransferRequests.recipientId, recipientId));

  /** Initiator withdraws before the recipient answers. */
  cancel = async (id: string, initiatorId: string): Promise<ResourceTransferRequestItem> =>
    this.transition(id, 'cancelled', eq(resourceTransferRequests.initiatorId, initiatorId));

  /**
   * Void the live request when the resource stops being transferable — it was
   * deleted, or left the workspace through the cross-scope transfer path.
   * No-op when nothing is pending.
   */
  invalidateForResources = async (
    resourceType: TransferResourceType,
    resourceIds: string[],
    trx?: Executor,
  ): Promise<void> => {
    if (resourceIds.length === 0) return;
    const voided = await (trx ?? this.db)
      .update(resourceTransferRequests)
      .set({ resolvedAt: new Date(), status: 'cancelled' })
      .where(
        and(
          eq(resourceTransferRequests.workspaceId, this.workspaceId),
          eq(resourceTransferRequests.resourceType, resourceType),
          inArray(resourceTransferRequests.resourceId, resourceIds),
          eq(resourceTransferRequests.status, 'pending'),
        ),
      )
      .returning({ id: resourceTransferRequests.id });
    await this.settleLinkedInboxRows(
      voided.map((row) => row.id),
      trx,
    );
  };

  /**
   * Retire ONE request that turned out to be unfulfillable (e.g. the
   * initiator's authority went stale). Conditional on `pending` so it cannot
   * touch a racing replacement request for the same resource. No-op when the
   * request already resolved.
   */
  invalidateRequest = async (id: string): Promise<void> => {
    const voided = await this.db
      .update(resourceTransferRequests)
      .set({ resolvedAt: new Date(), status: 'cancelled' })
      .where(
        and(
          eq(resourceTransferRequests.id, id),
          eq(resourceTransferRequests.workspaceId, this.workspaceId),
          eq(resourceTransferRequests.status, 'pending'),
        ),
      )
      .returning({ id: resourceTransferRequests.id });
    await this.settleLinkedInboxRows(voided.map((row) => row.id));
  };

  /**
   * A pending item's read state IS its handled state: the request notice
   * (linked through `metadata.transfer.requestId`) stays unread while the
   * request is live, and reads the moment the request leaves `pending` —
   * whichever way (accept / decline / withdraw / expiry / invalidation).
   * Every state transition in this model funnels through here so the inbox
   * never shows an "unread" notice for a request nobody can act on anymore.
   */
  private settleLinkedInboxRows = async (requestIds: string[], trx?: Executor): Promise<void> => {
    if (requestIds.length === 0) return;
    await (trx ?? this.db)
      .update(notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(
          eq(notifications.isRead, false),
          inArray(sql`${notifications.metadata} -> 'transfer' ->> 'requestId'`, requestIds),
        ),
      );
  };

  private pendingResourceMatch = (resourceType: TransferResourceType, resourceId: string) =>
    and(
      eq(resourceTransferRequests.workspaceId, this.workspaceId),
      eq(resourceTransferRequests.resourceType, resourceType),
      eq(resourceTransferRequests.resourceId, resourceId),
      eq(resourceTransferRequests.status, 'pending'),
      // A deleted recipient account nulls `recipient_id` (FK SET NULL) while
      // the row stays `pending`; the partial unique index already ignores such
      // orphans, so pending lookups must too or they shadow the replacement
      // request.
      isNotNull(resourceTransferRequests.recipientId),
    );

  private expireOverdue = async (resourceType: TransferResourceType, resourceId: string) => {
    const expired = await this.db
      .update(resourceTransferRequests)
      .set({ resolvedAt: sql`now()`, status: 'expired' })
      .where(
        and(
          this.pendingResourceMatch(resourceType, resourceId),
          lte(resourceTransferRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: resourceTransferRequests.id });
    await this.settleLinkedInboxRows(expired.map((row) => row.id));
  };

  /** Stamp an overdue pending row `expired` on read, so callers never act on one. */
  private withLazyExpiry = async (
    row: ResourceTransferRequestItem,
  ): Promise<ResourceTransferRequestItem> => {
    if (row.status !== 'pending' || row.expiresAt.getTime() > Date.now()) return row;

    const resolvedAt = new Date();
    // Conditional so a racing accept/decline that already resolved it wins.
    const [updated] = await this.db
      .update(resourceTransferRequests)
      .set({ resolvedAt, status: 'expired' })
      .where(
        and(
          eq(resourceTransferRequests.id, row.id),
          eq(resourceTransferRequests.status, 'pending'),
        ),
      )
      .returning();
    // Whether this call stamped it or a racer resolved it first, the request
    // is no longer live — settle the notice either way (idempotent).
    await this.settleLinkedInboxRows([row.id]);
    return updated ?? (await this.reload(row.id)) ?? { ...row, resolvedAt, status: 'expired' };
  };

  private reload = async (id: string): Promise<ResourceTransferRequestItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(resourceTransferRequests)
      .where(eq(resourceTransferRequests.id, id))
      .limit(1);
    return row;
  };

  /**
   * One guarded state transition. The UPDATE itself carries every condition
   * (live, unexpired, right actor), so concurrent transitions serialize on the
   * row and exactly one wins; losers get a precise error by re-reading.
   */
  private transition = async (
    id: string,
    status: 'accepted' | 'cancelled' | 'declined',
    actorMatch: ReturnType<typeof eq>,
    trx?: Executor,
  ): Promise<ResourceTransferRequestItem> => {
    const now = new Date();
    const [updated] = await (trx ?? this.db)
      .update(resourceTransferRequests)
      .set({ resolvedAt: now, status })
      .where(
        and(
          eq(resourceTransferRequests.id, id),
          eq(resourceTransferRequests.workspaceId, this.workspaceId),
          eq(resourceTransferRequests.status, 'pending'),
          gt(resourceTransferRequests.expiresAt, now),
          actorMatch,
        ),
      )
      .returning();

    if (updated) {
      await this.settleLinkedInboxRows([updated.id], trx);
      return updated;
    }

    // Distinguish "expired" from every other dead end so the recipient gets an
    // actionable message rather than a generic failure.
    const current = await this.reload(id);
    if (
      current &&
      current.workspaceId === this.workspaceId &&
      current.status === 'pending' &&
      current.expiresAt.getTime() <= now.getTime()
    ) {
      await this.withLazyExpiry(current);
      throw new Error(TRANSFER_REQUEST_EXPIRED);
    }
    throw new Error(TRANSFER_REQUEST_NOT_PENDING);
  };
}
