import type { WebhookEventType } from '@lobechat/types';
import type { Context } from 'hono';

import { type ApiKeyScope, hasApiKeyScope } from '@/const/apiKeyScope';

import { BaseController } from '../common/base.controller';
import { ApiException } from '../common/errors';
import { WebhookRestService } from '../services/webhook.service';
import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookDeliveryParam,
  WebhookIdParam,
  WebhookListQuery,
} from '../types/webhook.type';

/**
 * The read scope an API key needs to subscribe to an event: an endpoint receives
 * that domain's data, so `webhook:write` alone must not open it up.
 */
export const WEBHOOK_EVENT_READ_SCOPES: Record<WebhookEventType, ApiKeyScope> = {
  'file.parsed': 'file:read',
  'goal.status_changed': 'agent:read',
  'message.created': 'chat:read',
  'notification.created': 'user:read',
  'run.completed': 'run:read',
  'run.failed': 'run:read',
  'run.intervention_requested': 'run:read',
  'run.started': 'run:read',
  'task.status_changed': 'agent:read',
  'topic.created': 'chat:read',
};

/** 403 when the calling API key lacks the read scope of a subscribed event. */
const assertCanSubscribe = (c: Context, events: WebhookEventType[] | undefined) => {
  if (!events) return;
  const scopes = c.get('apiKeyScopes') as string[] | null | undefined;
  const missing = [
    ...new Set(
      events
        .map((event) => WEBHOOK_EVENT_READ_SCOPES[event])
        .filter((scope) => !hasApiKeyScope(scopes, scope)),
    ),
  ];
  if (missing.length > 0)
    throw new ApiException(
      403,
      'insufficient_scope',
      `insufficient_scope: subscribing to these events needs ${missing.map((s) => `\`${s}\``).join(', ')}`,
    );
};

/**
 * Developer webhooks controller.
 * Handles HTTP concerns only — endpoint management and delivery live in
 * `DeveloperWebhookService`, wrapped by `WebhookRestService`.
 */
export class WebhookController extends BaseController {
  private async service(c: Context): Promise<WebhookRestService> {
    return new WebhookRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/webhooks */
  async listWebhooks(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<WebhookListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.list(query), {
        message: 'Webhook list retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/webhooks */
  async createWebhook(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateWebhookRequest>(c);
      assertCanSubscribe(c, body.events);
      const service = await this.service(c);
      return this.success(c, await service.create(body), 'Webhook created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/webhooks/:id */
  async getWebhook(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.get(id), 'Webhook retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/webhooks/:id */
  async updateWebhook(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const body = await this.getBody<UpdateWebhookRequest>(c);
      assertCanSubscribe(c, body.events);
      const service = await this.service(c);
      return this.success(c, await service.update(id, body), 'Webhook updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/webhooks/:id */
  async deleteWebhook(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.delete(id), 'Webhook deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/webhooks/:id/rotate-secret */
  async rotateWebhookSecret(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.rotateSecret(id), 'Webhook secret rotated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/webhooks/:id/test */
  async testWebhook(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.test(id), 'Test event sent');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/webhooks/:id/deliveries */
  async listWebhookDeliveries(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<WebhookIdParam>(c);
      const query = this.getQuery<WebhookListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listDeliveries(id, query), {
        message: 'Webhook deliveries retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/webhooks/:id/deliveries/:deliveryId/redeliver */
  async redeliverWebhookDelivery(c: Context): Promise<Response> {
    try {
      const { deliveryId, id } = this.getParams<WebhookDeliveryParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.redeliver(id, deliveryId), 'Redelivery queued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
