import type {
  WebhookDeliveryStatus,
  WebhookDisabledReason,
  WebhookEventEnvelope,
  WebhookEventType,
} from '@lobechat/types';
import { and, count, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';

import type { NewWebhookDeliveryRow, WebhookDeliveryRow, WebhookEndpointRow } from '../schemas';
import { webhookDeliveries, webhookEndpoints } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** An endpoint as callers see it: the encrypted secret never leaves the model. */
export type WebhookEndpointView = Omit<WebhookEndpointRow, 'secret'>;

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
    const patch: Partial<WebhookEndpointRow> = { ...value, updatedAt: new Date() };
    // Re-enabling clears the auto-disable state; disabling by hand records why.
    if (value.enabled === true)
      Object.assign(patch, { consecutiveFailures: 0, disabledReason: null });
    if (value.enabled === false) patch.disabledReason = 'manual' satisfies WebhookDisabledReason;

    const [row] = await this.db
      .update(webhookEndpoints)
      .set(patch)
      .where(and(eq(webhookEndpoints.id, id), this.ownership()))
      .returning(endpointViewColumns);
    return row;
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

  listDeliveries = async (endpointId: string, { limit, offset }: WebhookListParams) => {
    const where = and(
      eq(webhookDeliveries.endpointId, endpointId),
      eq(webhookDeliveries.userId, this.userId),
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

  /** Record one attempt. `status` is the delivery's state after it. */
  recordAttempt = async (
    deliveryId: string,
    result: WebhookAttemptResult & {
      attempts: number;
      nextAttemptAt: Date | null;
      status: WebhookDeliveryStatus;
    },
  ): Promise<void> => {
    const now = new Date();
    await this.db
      .update(webhookDeliveries)
      .set({
        ...result,
        deliveredAt: result.status === 'succeeded' ? now : null,
        updatedAt: now,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
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
