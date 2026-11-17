import type { WebhookDeliveryEventType } from '@lobechat/types';
import {
  WEBHOOK_DELIVERY_POLICY,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_HEADERS,
  WEBHOOK_SIGNATURE_VERSION,
} from '@lobechat/types';
import { z } from 'zod';

import {
  WEBHOOK_EVENT_ENVELOPE_SCHEMAS,
  webhookEventComponentName,
  WebhookEventSchema,
} from './types/webhook.type';

/**
 * The outbound side of developer webhooks in the OpenAPI document: the
 * top-level `webhooks` map (one entry per event type, OpenAPI 3.1) and the
 * `webhooks` tag description that explains signing and retries.
 */

const COMPONENT_PREFIX = '#/components/schemas/';

const retrySchedule = Array.from(
  { length: WEBHOOK_DELIVERY_POLICY.maxAttempts - 1 },
  (_, index) =>
    WEBHOOK_DELIVERY_POLICY.baseDelaySeconds * WEBHOOK_DELIVERY_POLICY.backoffFactor ** index,
)
  .map((seconds) => (seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)}m`))
  .join(', ');

export const WEBHOOKS_TAG_DESCRIPTION = `Register HTTPS endpoints that LobeHub POSTs events to. Each event type is documented under **Webhooks** with its JSON body.

## Delivery

Every delivery is a \`POST\` with a JSON body \`{ id, type, createdAt, workspaceId, data }\` and these headers:

- \`${WEBHOOK_HEADERS.signature}\`: \`${WEBHOOK_SIGNATURE_VERSION}=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>\`
- \`${WEBHOOK_HEADERS.timestamp}\`: Unix seconds the signature was computed at
- \`${WEBHOOK_HEADERS.eventId}\`: the event id (same as \`id\` in the body); stays the same across retries and redeliveries, so dedupe on it
- \`${WEBHOOK_HEADERS.eventType}\`: the event type (same as \`type\` in the body)
- \`${WEBHOOK_HEADERS.deliveryId}\`: this delivery's id

Answer with any 2xx status within ${WEBHOOK_DELIVERY_POLICY.timeoutMs / 1000} s. Anything else (or a timeout) is retried up to ${WEBHOOK_DELIVERY_POLICY.maxAttempts - 1} more times with exponential backoff (${retrySchedule}). After ${WEBHOOK_DELIVERY_POLICY.disableAfterConsecutiveFailures} deliveries in a row run out of retries, the endpoint is disabled (\`disabledReason: consecutive_failures\`); re-enable it with \`PATCH /webhooks/{id}\`. Redirects are not followed.

## Verifying signatures

1. Read \`${WEBHOOK_HEADERS.timestamp}\` and reject it if it is more than ${WEBHOOK_DELIVERY_POLICY.signatureToleranceSeconds} seconds from now (replay protection).
2. Compute \`HMAC-SHA256\` over \`<timestamp>.<raw request body>\` with the endpoint's secret (the whole \`whsec_…\` string as the key) and hex-encode it.
3. Compare it, in constant time, with each \`${WEBHOOK_SIGNATURE_VERSION}=\` value in \`${WEBHOOK_HEADERS.signature}\` (there may be several, separated by commas or spaces).

Use the raw body exactly as received: re-serialising parsed JSON changes the bytes. The TypeScript SDK ships \`verifyWebhookSignature()\` and \`constructWebhookEvent()\`.`;

const header = (name: string, description: string) => ({
  description,
  in: 'header' as const,
  name,
  required: true,
  schema: { type: 'string' as const },
});

const DELIVERY_HEADER_PARAMETERS = [
  header(
    WEBHOOK_HEADERS.signature,
    `\`${WEBHOOK_SIGNATURE_VERSION}=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>\`; several values may be separated by commas or spaces.`,
  ),
  header(
    WEBHOOK_HEADERS.timestamp,
    `Unix seconds the signature was computed at. Reject values more than ${WEBHOOK_DELIVERY_POLICY.signatureToleranceSeconds} s from now.`,
  ),
  header(WEBHOOK_HEADERS.eventId, 'Event id; the same across retries and redeliveries.'),
  header(WEBHOOK_HEADERS.eventType, 'Event type, e.g. `run.completed`.'),
  header(WEBHOOK_HEADERS.deliveryId, 'Id of this delivery (`whd_…`).'),
];

/**
 * The envelope and data schemas of every event as components. `z.toJSONSchema`
 * emits schemas carrying a meta id as local `$defs`, which the SDK generator
 * cannot resolve, so they are lifted into `components/schemas` and every ref is
 * rewritten to point there. Components the route schemas already registered
 * are kept as they are.
 */
const eventComponentSchemas = (): Record<string, unknown> => {
  const { $defs = {} } = z.toJSONSchema(WebhookEventSchema) as {
    $defs?: Record<string, unknown>;
  };
  return JSON.parse(JSON.stringify($defs).replaceAll('"#/$defs/', `"${COMPONENT_PREFIX}`));
};

const eventEntry = (type: WebhookDeliveryEventType) => ({
  post: {
    description: WEBHOOK_EVENT_DESCRIPTIONS[type],
    operationId: `webhookEvents.${type.replaceAll(/[._](\w)/g, (_, c: string) => c.toUpperCase())}`,
    parameters: DELIVERY_HEADER_PARAMETERS,
    requestBody: {
      content: {
        'application/json': {
          schema: { $ref: `${COMPONENT_PREFIX}${webhookEventComponentName(type)}` },
        },
      },
      required: true,
    },
    responses: {
      '2XX': {
        description:
          'Acknowledges the delivery. Any other status, or no answer within the timeout, is retried.',
      },
    },
    security: [],
    summary: type,
    tags: ['webhooks'],
  },
});

interface SpecWithWebhooks {
  components?: { schemas?: Record<string, unknown> };
  tags?: { description?: string; name: string }[];
  webhooks?: Record<string, unknown>;
}

/** Add the event catalogue (`webhooks`) and the `webhooks` tag description to `spec`. */
export const addWebhookEvents = (spec: SpecWithWebhooks) => {
  spec.components ??= {};
  const schemas = (spec.components.schemas ??= {});
  for (const [name, schema] of Object.entries(eventComponentSchemas())) {
    schemas[name] ??= schema;
  }

  spec.webhooks = Object.fromEntries(
    (Object.keys(WEBHOOK_EVENT_ENVELOPE_SCHEMAS) as WebhookDeliveryEventType[]).map((type) => [
      type,
      eventEntry(type),
    ]),
  );

  const tags = (spec.tags ??= []);
  const tag = tags.find(({ name }) => name === 'webhooks');
  if (tag) tag.description = WEBHOOKS_TAG_DESCRIPTION;
  else tags.push({ description: WEBHOOKS_TAG_DESCRIPTION, name: 'webhooks' });
};
