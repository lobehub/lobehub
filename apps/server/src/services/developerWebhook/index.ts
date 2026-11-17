import {
  WEBHOOK_TEST_EVENT_TYPE,
  type WebhookEventEnvelope,
  type WebhookEventType,
} from '@lobechat/types';

import {
  WebhookEndpointModel,
  type WebhookEndpointView,
  type WebhookListParams,
} from '@/database/models/developerWebhook';
import type { WebhookDeliveryRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';
import { DeveloperWebhookWorkflow } from '@/server/workflows/developerWebhook';

import { attemptWebhookDelivery } from './deliver';
import { createSealedWebhookSecret } from './secretVault';

export { emitWebhookEvent, publishWebhookEvent, type WebhookEventScope } from './emit';
export { signWebhookPayload } from './signature';

/** Endpoints one person may register in one space. */
export const MAX_WEBHOOK_ENDPOINTS = 20;

export type DeveloperWebhookErrorCode = 'limit_reached' | 'not_found';

export class DeveloperWebhookError extends Error {
  constructor(
    readonly code: DeveloperWebhookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeveloperWebhookError';
  }
}

export interface CreateWebhookInput {
  description?: string | null;
  enabled?: boolean;
  events: WebhookEventType[];
  url: string;
}

export type UpdateWebhookInput = Partial<CreateWebhookInput>;

/** An endpoint with its plaintext secret: returned only on create and on rotation. */
export type WebhookEndpointWithSecret = WebhookEndpointView & { secret: string };

const uniqueEvents = (events: WebhookEventType[]) => [...new Set(events)];

/**
 * Developer webhook management for one person in one space, shared by the REST API
 * (`/api/v1/webhooks`) and the settings page (tRPC).
 */
export class DeveloperWebhookService {
  private model: WebhookEndpointModel;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string | null,
  ) {
    this.model = new WebhookEndpointModel(db, userId, workspaceId);
  }

  list = (params: WebhookListParams) => this.model.list(params);

  get = async (id: string): Promise<WebhookEndpointView> => {
    const endpoint = await this.model.findById(id);
    if (!endpoint) throw new DeveloperWebhookError('not_found', 'Webhook not found');
    return endpoint;
  };

  create = async (input: CreateWebhookInput): Promise<WebhookEndpointWithSecret> => {
    const { total } = await this.model.list({ limit: 1, offset: 0 });
    if (total >= MAX_WEBHOOK_ENDPOINTS)
      throw new DeveloperWebhookError(
        'limit_reached',
        `At most ${MAX_WEBHOOK_ENDPOINTS} webhooks per space`,
      );

    const secret = await createSealedWebhookSecret();
    const endpoint = await this.model.create({
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      events: uniqueEvents(input.events),
      secret: secret.ciphertext,
      secretHint: secret.hint,
      url: input.url,
    });
    return { ...endpoint, secret: secret.plaintext };
  };

  update = async (id: string, input: UpdateWebhookInput): Promise<WebhookEndpointView> => {
    const endpoint = await this.model.update(id, {
      ...(input.description !== undefined && { description: input.description }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.events && { events: uniqueEvents(input.events) }),
      ...(input.url && { url: input.url }),
    });
    if (!endpoint) throw new DeveloperWebhookError('not_found', 'Webhook not found');
    return endpoint;
  };

  delete = async (id: string): Promise<void> => {
    if (!(await this.model.delete(id)))
      throw new DeveloperWebhookError('not_found', 'Webhook not found');
  };

  /** Replace the signing secret. The old one stops working immediately. */
  rotateSecret = async (id: string): Promise<WebhookEndpointWithSecret> => {
    await this.get(id);
    const secret = await createSealedWebhookSecret();
    const endpoint = await this.model.rotateSecret(id, secret);
    if (!endpoint) throw new DeveloperWebhookError('not_found', 'Webhook not found');
    return { ...endpoint, secret: secret.plaintext };
  };

  /**
   * Send a `webhook.test` event now and wait for the answer: one attempt, no retry,
   * and the endpoint's failure count is left alone. Works on a disabled endpoint too,
   * so the owner can check a fix before turning it back on.
   */
  test = async (id: string): Promise<WebhookDeliveryRow> => {
    const endpoint = await this.get(id);
    const payload: WebhookEventEnvelope<typeof WEBHOOK_TEST_EVENT_TYPE> = {
      createdAt: new Date().toISOString(),
      data: { message: 'This is a test event from LobeHub.', webhookId: endpoint.id },
      id: idGenerator('webhookEvents', 16),
      type: WEBHOOK_TEST_EVENT_TYPE,
      workspaceId: this.workspaceId ?? null,
    };
    const delivery = await this.model.createDelivery(endpoint, payload as WebhookEventEnvelope);
    await attemptWebhookDelivery(this.db, delivery.id);
    return (await this.model.findDelivery(endpoint.id, delivery.id)) ?? delivery;
  };

  listDeliveries = async (id: string, params: WebhookListParams) => {
    await this.get(id);
    return this.model.listDeliveries(id, params);
  };

  /** Queue the same event (same id and body) again as a new delivery. */
  redeliver = async (id: string, deliveryId: string): Promise<WebhookDeliveryRow> => {
    const endpoint = await this.get(id);
    const original = await this.model.findDelivery(id, deliveryId);
    if (!original) throw new DeveloperWebhookError('not_found', 'Delivery not found');

    const delivery = await this.model.createDelivery(endpoint, original.payload, {
      redeliveryOf: original.id,
    });
    await DeveloperWebhookWorkflow.triggerDeliver({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
    });
    return delivery;
  };
}
