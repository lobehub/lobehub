import {
  WEBHOOK_DELIVERY_POLICY,
  type WebhookDeliveryEventType,
  type WebhookDeliveryStatus,
  type WebhookDisabledReason,
  type WebhookEventEnvelope,
  type WebhookEventType,
} from '@lobechat/types';
import { and, count, desc, eq, getTableColumns, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { NewWebhookDeliveryRow, WebhookDeliveryRow, WebhookEndpointRow } from '../schemas';
import { webhookDeliveries, webhookEndpoints } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** An endpoint as callers see it: the encrypted secret never leaves the model. */
export type WebhookEndpointView = Omit<WebhookEndpointRow, 'secret'>;

/**
 * How long a claimed attempt holds its delivery: one request timeout plus slack for
 * the record write. A duplicate queue message inside this window cannot start a
 * second POST; a worker that died leaves the delivery claimable once it expires.
 */
const CLAIM_LEASE_MS = WEBHOOK_DELIVERY_POLICY.timeoutMs + 30_000;

export interface CreateWebhookEndpointParams {
  description?: string | null;
  enabled?: boolean;
  events: WebhookEventType[];
  /** KeyVaults ciphertext. */
  secret: string;
  secretHint: string;
  url: string;
}

export type UpdateWebhookEndpointParams = Partial<
  Pick<WebhookEndpointRow, 'description' | 'enabled' | 'events' | 'url'>
>;

export interface WebhookListParams {
  limit: number;
  offset: number;
}

const { secret: _secret, ...endpointViewColumns } = getTableColumns(webhookEndpoints);

/**
 * Developer webhooks belong to the person who registered them, inside one space:
 * a workspace endpoint is visible only to its creator in that workspace, a personal
 * endpoint only in the personal space. Events are routed with the same rule
 * ({@link WebhookEndpointModel.findSubscribed}), so an endpoint never receives what
 * its owner could not see.
 */
export class WebhookEndpointModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string | null,
  ) {}

  private ownership = () =>
    and(
      eq(webhookEndpoints.userId, this.userId),
      this.workspaceId
        ? eq(webhookEndpoints.workspaceId, this.workspaceId)
        : isNull(webhookEndpoints.workspaceId),
    );

  create = async (params: CreateWebhookEndpointParams): Promise<WebhookEndpointView> => {
    const [row] = await this.db
      .insert(webhookEndpoints)
      .values({
        ...params,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning(endpointViewColumns);
    return row;
  };

  list = async ({ limit, offset }: WebhookListParams) => {
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(endpointViewColumns)
        .from(webhookEndpoints)
        .where(this.ownership())
        .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(webhookEndpoints).where(this.ownership()),
    ]);
    return { items, total };
  };

  findById = async (id: string): Promise<WebhookEndpointView | undefined> => {
    const [row] = await this.db
      .select(endpointViewColumns)
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), this.ownership()))
      .limit(1);
    return row;
  };

  update = async (
    id: string,
    value: UpdateWebhookEndpointParams,
  ): Promise<WebhookEndpointView | undefined> => {
    const patch: Record<string, unknown> = { ...value, updatedAt: new Date() };
    // Only a change of `enabled` touches the disable state: turning an endpoint off
    // records it was by hand, turning it back on clears the failure streak. Saving an
    // edit that leaves `enabled` as it was keeps an auto-disable reason intact.
    if (value.enabled === true)
      Object.assign(patch, {
        consecutiveFailures: sql`CASE WHEN ${webhookEndpoints.enabled} THEN ${webhookEndpoints.consecutiveFailures} ELSE 0 END`,
        disabledReason: sql`CASE WHEN ${webhookEndpoints.enabled} THEN ${webhookEndpoints.disabledReason} ELSE NULL END`,
      });
    if (value.enabled === false)
      patch.disabledReason = sql`CASE WHEN ${webhookEndpoints.enabled} THEN ${'manual' satisfies WebhookDisabledReason} ELSE ${webhookEndpoints.disabledReason} END`;

    // Queued deliveries are sent to the endpoint's current URL. Moving the endpoint
    // must not carry payloads queued under the old destination (and possibly events
    // it no longer subscribes to) to the new one, so they are settled in the same write.
    if (value.url === undefined) {
      const [row] = await this.db
        .update(webhookEndpoints)
        .set(patch)
        .where(and(eq(webhookEndpoints.id, id), this.ownership()))
        .returning(endpointViewColumns);
      return row;
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ url: webhookEndpoints.url })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, id), this.ownership()))
        .for('update')
        .limit(1);
      if (!current) return undefined;

      const [row] = await tx
        .update(webhookEndpoints)
        .set(patch)
        .where(eq(webhookEndpoints.id, id))
        .returning(endpointViewColumns);
      if (current.url !== value.url)
        await tx
          .update(webhookDeliveries)
          .set({
            error: 'Not sent: the endpoint URL changed',
            nextAttemptAt: null,
            status: 'failed' satisfies WebhookDeliveryStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(webhookDeliveries.endpointId, id),
              inArray(webhookDeliveries.status, ['pending', 'retrying']),
            ),
          );
      return row;
    });
  };

  rotateSecret = async (
    id: string,
    secret: { ciphertext: string; hint: string },
  ): Promise<WebhookEndpointView | undefined> => {
    const [row] = await this.db
      .update(webhookEndpoints)
      .set({ secret: secret.ciphertext, secretHint: secret.hint, updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.id, id), this.ownership()))
      .returning(endpointViewColumns);
    return row;
  };

  delete = async (id: string): Promise<boolean> => {
    const rows = await this.db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), this.ownership()))
      .returning({ id: webhookEndpoints.id });
    return rows.length > 0;
  };

  /** Whether this owner has any enabled endpoint in this space. */
  hasEnabled = async (): Promise<boolean> => {
    const [row] = await this.db
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(and(this.ownership(), eq(webhookEndpoints.enabled, true)))
      .limit(1);
    return !!row;
  };

  /** Enabled endpoints of this owner and space that subscribe to `type`. */
  findSubscribed = async (type: WebhookEventType): Promise<WebhookEndpointView[]> =>
    this.db
      .select(endpointViewColumns)
      .from(webhookEndpoints)
      .where(
        and(
          this.ownership(),
          eq(webhookEndpoints.enabled, true),
          sql`${webhookEndpoints.events} @> ${JSON.stringify([type])}::jsonb`,
        ),
      );

  // -------------------------------------------------------------------------
  // Deliveries
  // -------------------------------------------------------------------------

  createDelivery = async (
    endpoint: Pick<WebhookEndpointView, 'id'>,
    payload: WebhookEventEnvelope,
    extra: Pick<NewWebhookDeliveryRow, 'redeliveryOf'> = {},
  ): Promise<WebhookDeliveryRow> => {
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({
        ...extra,
        endpointId: endpoint.id,
        eventId: payload.id,
        eventType: payload.type,
        payload,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning();
    return row;
  };

  /**
   * Records a delivery only while the endpoint still matches what the publisher read.
   *
   * {@link findSubscribed} reads endpoints outside any transaction, so a redirect can land
   * between that read and this insert. {@link update} settles what is queued under the old
   * URL, but it cannot reach a row that does not exist yet — that payload would then be sent
   * to the new destination. This insert takes the same row lock before it checks the
   * snapshot, so the two writes cannot cross: either the redirect commits first and nothing
   * is queued, or the row exists by the time the redirect settles it.
   *
   * Answers `undefined` when the endpoint has moved on: another destination, disabled, or
   * no longer subscribed to `payload.type`.
   */
  createDeliveryForSubscription = async (
    snapshot: Pick<WebhookEndpointView, 'id' | 'url'>,
    payload: WebhookEventEnvelope,
  ): Promise<WebhookDeliveryRow | undefined> =>
    this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          enabled: webhookEndpoints.enabled,
          events: webhookEndpoints.events,
          url: webhookEndpoints.url,
        })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, snapshot.id), this.ownership()))
        .for('update')
        .limit(1);

      if (!current || !current.enabled) return undefined;
      if (current.url !== snapshot.url) return undefined;
      if (!current.events.includes(payload.type)) return undefined;

      const [row] = await tx
        .insert(webhookDeliveries)
        .values({
          endpointId: snapshot.id,
          eventId: payload.id,
          eventType: payload.type,
          payload,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();
      return row;
    });

  /** `eventTypes` limits the log to those events (a caller that may not read the rest). */
  listDeliveries = async (
    endpointId: string,
    { limit, offset }: WebhookListParams,
    eventTypes?: readonly WebhookDeliveryEventType[],
  ) => {
    const where = and(
      eq(webhookDeliveries.endpointId, endpointId),
      eq(webhookDeliveries.userId, this.userId),
      eventTypes ? inArray(webhookDeliveries.eventType, [...eventTypes]) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(webhookDeliveries)
        .where(where)
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(webhookDeliveries).where(where),
    ]);
    return { items, total };
  };

  findDelivery = async (
    endpointId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.userId, this.userId),
        ),
      )
      .limit(1);
    return row;
  };
}

export interface WebhookAttemptResult {
  durationMs: number | null;
  error: string | null;
  responseBody: string | null;
  responseStatus: number | null;
}

/**
 * The delivery worker's side: it runs from a queue callback with no user context,
 * addressing one delivery by id. Never expose it to a request handler.
 */
export class WebhookDeliveryWorkerModel {
  constructor(private db: LobeChatDatabase) {}

  /** The delivery, its endpoint, and the endpoint's encrypted secret. */
  load = async (deliveryId: string) => {
    const [row] = await this.db
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(eq(webhookDeliveries.id, deliveryId))
      .limit(1);
    return row;
  };

  /**
   * Take the next attempt of a due delivery: bumps `attempts` only if nobody else did
   * since it was read, and parks `nextAttemptAt` one lease ahead so a duplicate queue
   * message that re-reads the bumped counter still cannot claim the same attempt
   * (its `nextAttemptAt` is in the future). Answers the new attempt number, or `null`
   * when another worker holds the attempt or it is not due yet.
   */
  claimAttempt = async (deliveryId: string, readAttempts: number): Promise<number | null> => {
    const now = new Date();
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.attempts, readAttempts),
          inArray(webhookDeliveries.status, ['pending', 'retrying']),
          or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)),
        ),
      )
      .returning({ attempts: webhookDeliveries.attempts });
    return row?.attempts ?? null;
  };

  /**
   * Record one attempt. `status` is the delivery's state after it.
   * Answers whether the attempt was settled: a row that is already terminal (`failed`
   * or `succeeded`) keeps its outcome, so an endpoint redirect that canceled the
   * delivery while this POST was in flight is never revived into a retry.
   */
  recordAttempt = async (
    deliveryId: string,
    result: WebhookAttemptResult & {
      attempts: number;
      nextAttemptAt: Date | null;
      status: WebhookDeliveryStatus;
    },
  ): Promise<boolean> => {
    const now = new Date();
    const settled = await this.db
      .update(webhookDeliveries)
      .set({
        ...result,
        deliveredAt: result.status === 'succeeded' ? now : null,
        updatedAt: now,
      })
      // Settle the attempt this worker claimed, not whatever the row says now: a stale
      // attempt must not overwrite the outcome a newer one already wrote, and a delivery
      // canceled in between must stay canceled instead of being scheduled for a retry.
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.attempts, result.attempts),
          inArray(webhookDeliveries.status, ['pending', 'retrying']),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    return settled.length > 0;
  };

  /** A delivery got through: the endpoint's failure streak ends. */
  markEndpointSucceeded = async (endpointId: string): Promise<void> => {
    const now = new Date();
    await this.db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 0, lastDeliveryAt: now, updatedAt: now })
      .where(eq(webhookEndpoints.id, endpointId));
  };

  /**
   * A delivery exhausted its retries. Disables the endpoint once `disableAfter`
   * deliveries in a row have failed; answers whether this call disabled it.
   */
  markEndpointFailed = async (endpointId: string, disableAfter: number): Promise<boolean> => {
    const now = new Date();
    const [row] = await this.db
      .update(webhookEndpoints)
      .set({
        consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
        lastDeliveryAt: now,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, endpointId))
      .returning({
        consecutiveFailures: webhookEndpoints.consecutiveFailures,
        enabled: webhookEndpoints.enabled,
      });
    if (!row?.enabled || row.consecutiveFailures < disableAfter) return false;

    const disabled = await this.db
      .update(webhookEndpoints)
      .set({
        disabledReason: 'consecutive_failures' satisfies WebhookDisabledReason,
        enabled: false,
        updatedAt: now,
      })
      .where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.enabled, true)))
      .returning({ id: webhookEndpoints.id });
    return disabled.length > 0;
  };
}
