import type { WebhookEndpointView } from '@/database/models/developerWebhook';
import type { WebhookDeliveryRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  type DeliveryAccess,
  DeveloperWebhookError,
  DeveloperWebhookService,
} from '@/server/services/developerWebhook';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookDeliveryResponse,
  WebhookListQuery,
  WebhookResponse,
} from '../types/webhook.type';

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The public shape of an endpoint: no owner id, dates as ISO strings. */
const toWebhook = (endpoint: WebhookEndpointView): WebhookResponse => ({
  consecutiveFailures: endpoint.consecutiveFailures,
  createdAt: endpoint.createdAt.toISOString(),
  description: endpoint.description,
  disabledReason: endpoint.disabledReason,
  enabled: endpoint.enabled,
  events: endpoint.events,
  id: endpoint.id,
  lastDeliveryAt: iso(endpoint.lastDeliveryAt),
  secretHint: endpoint.secretHint,
  updatedAt: endpoint.updatedAt.toISOString(),
  url: endpoint.url,
  workspaceId: endpoint.workspaceId,
});

const toDelivery = (delivery: WebhookDeliveryRow): WebhookDeliveryResponse => ({
  attempts: delivery.attempts,
  createdAt: delivery.createdAt.toISOString(),
  deliveredAt: iso(delivery.deliveredAt),
  durationMs: delivery.durationMs,
  error: delivery.error,
  eventId: delivery.eventId,
  eventType: delivery.eventType,
  id: delivery.id,
  nextAttemptAt: iso(delivery.nextAttemptAt),
  payload: delivery.payload as WebhookDeliveryResponse['payload'],
  redeliveryOf: delivery.redeliveryOf,
  responseBody: delivery.responseBody,
  responseStatus: delivery.responseStatus,
  status: delivery.status,
  webhookId: delivery.endpointId,
});

/**
 * Developer webhooks REST service.
 *
 * A transport shell over `DeveloperWebhookService` (shared with the settings
 * page): it scopes every call to the caller and the resolved space, shapes rows
 * into the public schema, and turns the domain's refusals into HTTP errors.
 */
export class WebhookRestService extends BaseService {
  private readonly webhooks: DeveloperWebhookService;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.webhooks = new DeveloperWebhookService(db, userId ?? '', workspaceId ?? null);
  }

  /** `not_found` → 404, `forbidden_event` → 403, `limit_reached` → 409; anything else is left to `handleError` (500). */
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof DeveloperWebhookError) {
        if (error.code === 'forbidden_event')
          throw new ApiException(403, 'insufficient_scope', `insufficient_scope: ${error.message}`);
        throw error.code === 'not_found'
          ? this.createNotFoundError(error.message)
          : this.createConflictError(error.message);
      }
      throw error;
    }
  }

  async list(query: WebhookListQuery) {
    const { limit, offset } = resolvePagination(query);
    const { items, total } = await this.run(() => this.webhooks.list({ limit, offset }));
    return { items: items.map(toWebhook), total };
  }

  async get(id: string) {
    return toWebhook(await this.run(() => this.webhooks.get(id)));
  }

  async create(input: CreateWebhookRequest) {
    const { secret, ...endpoint } = await this.run(() => this.webhooks.create(input));
    return { ...toWebhook(endpoint), secret };
  }

  async update(id: string, input: UpdateWebhookRequest) {
    return toWebhook(await this.run(() => this.webhooks.update(id, input)));
  }

  async delete(id: string): Promise<DeletedResource> {
    await this.run(() => this.webhooks.delete(id));
    return { deleted: true, id };
  }

  async rotateSecret(id: string) {
    const { secret, ...endpoint } = await this.run(() => this.webhooks.rotateSecret(id));
    return { ...toWebhook(endpoint), secret };
  }

  async test(id: string) {
    return toDelivery(await this.run(() => this.webhooks.test(id)));
  }

  async listDeliveries(id: string, query: WebhookListQuery, access?: DeliveryAccess) {
    const { limit, offset } = resolvePagination(query);
    const { items, total } = await this.run(() =>
      this.webhooks.listDeliveries(id, { limit, offset }, access),
    );
    return { items: items.map(toDelivery), total };
  }

  async redeliver(id: string, deliveryId: string, access?: DeliveryAccess) {
    return toDelivery(await this.run(() => this.webhooks.redeliver(id, deliveryId, access)));
  }
}
