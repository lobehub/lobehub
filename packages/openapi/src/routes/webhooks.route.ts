import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { WebhookController } from '../controllers/webhook.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateWebhookRequestSchema,
  UpdateWebhookRequestSchema,
  WebhookDeliveryListResponseSchema,
  WebhookDeliveryParamSchema,
  WebhookDeliverySchema,
  WebhookIdParamSchema,
  WebhookListQuerySchema,
  WebhookListResponseSchema,
  WebhookSchema,
  WebhookWithSecretSchema,
} from '../types/webhook.type';

/**
 * Developer webhook routes.
 *
 * An endpoint is a URL LobeHub POSTs signed events to. Endpoints belong to the
 * caller inside the resolved space (personal, or the `X-Workspace-Id`
 * workspace): nobody else — not even a workspace admin — can list or change
 * them, and an endpoint only receives events its owner could see. That
 * ownership rule is the whole access model, so the routes gate on API key
 * scopes only (`webhook:read` / `webhook:write`), like `/usage`.
 */
const WebhookRoutes = new Hono();

const webhookRead = requireApiKeyScope('webhook:read');
const webhookWrite = requireApiKeyScope('webhook:write');

const TAGS = ['webhooks'];

/** GET /api/v1/webhooks */
WebhookRoutes.get(
  '/',
  routeDoc({
    data: WebhookListResponseSchema,
    description: 'Endpoints the caller registered in this space, newest first.',
    operationId: 'webhooks.list',
    summary: 'List webhook endpoints',
    tags: TAGS,
  }),
  requireAuth,
  webhookRead,
  zValidator('query', WebhookListQuerySchema),
  async (c) => new WebhookController().listWebhooks(c),
);

/** POST /api/v1/webhooks */
WebhookRoutes.post(
  '/',
  routeDoc({
    data: WebhookWithSecretSchema,
    description:
      'Registers an endpoint and returns its signing secret. The secret is shown only here and on rotate-secret — store it to verify `X-LobeHub-Signature`. At most 20 endpoints per space (409 beyond that).',
    errors: [409],
    operationId: 'webhooks.create',
    requestExample: example(CreateWebhookRequestSchema, {
      description: 'Notify CI when a run finishes',
      events: ['run.completed', 'run.failed'],
      url: 'https://example.com/lobehub/webhook',
    }),
    status: 201,
    summary: 'Create a webhook endpoint',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('json', CreateWebhookRequestSchema),
  async (c) => new WebhookController().createWebhook(c),
);

/** GET /api/v1/webhooks/:id */
WebhookRoutes.get(
  '/:id',
  routeDoc({
    data: WebhookSchema,
    errors: [404],
    operationId: 'webhooks.get',
    summary: 'Get a webhook endpoint',
    tags: TAGS,
  }),
  requireAuth,
  webhookRead,
  zValidator('param', WebhookIdParamSchema),
  async (c) => new WebhookController().getWebhook(c),
);

/** PATCH /api/v1/webhooks/:id */
WebhookRoutes.patch(
  '/:id',
  routeDoc({
    data: WebhookSchema,
    description:
      'Change the URL, events, description, or turn the endpoint on or off. Turning a disabled endpoint back on resets its failure streak.',
    errors: [404],
    operationId: 'webhooks.update',
    summary: 'Update a webhook endpoint',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('param', WebhookIdParamSchema),
  zValidator('json', UpdateWebhookRequestSchema),
  async (c) => new WebhookController().updateWebhook(c),
);

/** DELETE /api/v1/webhooks/:id */
WebhookRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Deletes the endpoint and its delivery log; pending retries are dropped.',
    errors: [404],
    operationId: 'webhooks.delete',
    summary: 'Delete a webhook endpoint',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('param', WebhookIdParamSchema),
  async (c) => new WebhookController().deleteWebhook(c),
);

/** POST /api/v1/webhooks/:id/rotate-secret */
WebhookRoutes.post(
  '/:id/rotate-secret',
  routeDoc({
    data: WebhookWithSecretSchema,
    description:
      'Replaces the signing secret and returns the new one. The old secret stops working immediately.',
    errors: [404],
    operationId: 'webhooks.rotateSecret',
    summary: 'Rotate the signing secret',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('param', WebhookIdParamSchema),
  async (c) => new WebhookController().rotateWebhookSecret(c),
);

/** POST /api/v1/webhooks/:id/test */
WebhookRoutes.post(
  '/:id/test',
  routeDoc({
    data: WebhookDeliverySchema,
    description:
      'Sends a `webhook.test` event now and waits for the answer: one attempt, no retries, and the failure streak is left alone. Works on a disabled endpoint too. A failed attempt still answers 200 — read `status`, `responseStatus` and `error` on the delivery.',
    errors: [404],
    operationId: 'webhooks.test',
    summary: 'Send a test event',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('param', WebhookIdParamSchema),
  async (c) => new WebhookController().testWebhook(c),
);

/** GET /api/v1/webhooks/:id/deliveries */
WebhookRoutes.get(
  '/:id/deliveries',
  routeDoc({
    data: WebhookDeliveryListResponseSchema,
    description:
      'Deliveries to this endpoint, newest first, with the latest attempt of each and the exact body sent.',
    errors: [404],
    operationId: 'webhooks.listDeliveries',
    summary: 'List deliveries of a webhook endpoint',
    tags: TAGS,
  }),
  requireAuth,
  webhookRead,
  zValidator('param', WebhookIdParamSchema),
  zValidator('query', WebhookListQuerySchema),
  async (c) => new WebhookController().listWebhookDeliveries(c),
);

/** POST /api/v1/webhooks/:id/deliveries/:deliveryId/redeliver */
WebhookRoutes.post(
  '/:id/deliveries/:deliveryId/redeliver',
  routeDoc({
    data: WebhookDeliverySchema,
    description:
      'Queues the same event (same event id and body) again as a new delivery, which follows the normal retry policy. Answers 202 with the new delivery; follow it through `GET /webhooks/{id}/deliveries`.',
    errors: [404],
    operationId: 'webhooks.redeliver',
    status: 202,
    summary: 'Redeliver an event',
    tags: TAGS,
  }),
  requireAuth,
  webhookWrite,
  zValidator('param', WebhookDeliveryParamSchema),
  async (c) => new WebhookController().redeliverWebhookDelivery(c),
);

export default WebhookRoutes;
