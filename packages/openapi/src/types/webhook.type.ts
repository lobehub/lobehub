import type { WebhookDeliveryEventType } from '@lobechat/types';
import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DISABLED_REASONS,
  WEBHOOK_EVENT_DATA_SCHEMAS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT_TYPE,
} from '@lobechat/types';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

// ==================== Path / Query Schemas ====================

export const WebhookIdParamSchema = z.object({ id: z.string().min(1) });
export type WebhookIdParam = z.infer<typeof WebhookIdParamSchema>;

export const WebhookDeliveryParamSchema = z.object({
  deliveryId: z.string().min(1),
  id: z.string().min(1),
});
export type WebhookDeliveryParam = z.infer<typeof WebhookDeliveryParamSchema>;

export const WebhookListQuerySchema = CursorPaginationQuerySchema;
export type WebhookListQuery = z.infer<typeof WebhookListQuerySchema>;

// ==================== Request Schemas ====================

const WebhookUrlSchema = z
  .url()
  .max(2048)
  // zod still runs refinements after `url()` fails, so guard the parse.
  .refine((value) => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Webhook URL must use http or https',
  })
  .describe('Where deliveries are POSTed. Must be an http(s) URL reachable from the internet.');

const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

const WebhookEventsSchema = z
  .array(WebhookEventTypeSchema)
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length * 2)
  .describe('Event types this endpoint receives. Duplicates are ignored.');

const WebhookDescriptionSchema = z.string().trim().max(500).nullable();

export const CreateWebhookRequestSchema = z
  .object({
    description: WebhookDescriptionSchema.optional(),
    enabled: z.boolean().optional().describe('Defaults to `true`.'),
    events: WebhookEventsSchema,
    url: WebhookUrlSchema,
  })
  .strict();
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

export const UpdateWebhookRequestSchema = z
  .object({
    description: WebhookDescriptionSchema.optional(),
    enabled: z
      .boolean()
      .optional()
      .describe('Turning an endpoint back on also clears its failure streak and `disabledReason`.'),
    events: WebhookEventsSchema.optional(),
    url: WebhookUrlSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;

// ==================== Event envelopes ====================

/** `run.intervention_requested` → `RunInterventionRequested` */
const pascalEventName = (type: string) =>
  type
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** Component name of an event's envelope, e.g. `WebhookRunCompletedEvent` (`webhook.test` → `WebhookTestEvent`). */
export const webhookEventComponentName = (type: WebhookDeliveryEventType) =>
  `Webhook${pascalEventName(type).replace(/^Webhook/, '')}Event`;

const envelopeFor = <T extends WebhookDeliveryEventType>(type: T) =>
  z
    .object({
      createdAt: dateTimeSchema.describe('When the event happened.'),
      data: WEBHOOK_EVENT_DATA_SCHEMAS[type].strict().meta({
        id: `${webhookEventComponentName(type)}Data`,
      }),
      id: z
        .string()
        .describe('`evt_…`; stays the same across retries and redeliveries — dedupe on it.'),
      type: z.literal(type),
      workspaceId: z
        .string()
        .nullable()
        .describe('Workspace the event happened in; `null` for a personal space.'),
    })
    .strict()
    .meta({
      description: WEBHOOK_EVENT_DESCRIPTIONS[type],
      id: webhookEventComponentName(type),
    });

const DELIVERY_EVENT_TYPES = [...WEBHOOK_EVENT_TYPES, WEBHOOK_TEST_EVENT_TYPE] as const;

/** One envelope schema per event type: the JSON body of a delivery of that event. */
export const WEBHOOK_EVENT_ENVELOPE_SCHEMAS = Object.fromEntries(
  DELIVERY_EVENT_TYPES.map((type) => [type, envelopeFor(type)]),
) as { [K in WebhookDeliveryEventType]: ReturnType<typeof envelopeFor<K>> };

const envelopes = DELIVERY_EVENT_TYPES.map((type) => WEBHOOK_EVENT_ENVELOPE_SCHEMAS[type]);

export const WebhookEventSchema = z
  .discriminatedUnion(
    'type',
    envelopes as unknown as [(typeof envelopes)[number], ...(typeof envelopes)[number][]],
  )
  .meta({
    description:
      'The JSON body of a delivery, discriminated by `type`. See the top-level `webhooks` section for each event.',
    id: 'WebhookEvent',
  });

// ==================== Response Schemas ====================

export const WebhookSchema = z
  .object({
    consecutiveFailures: z
      .number()
      .int()
      .min(0)
      .describe('Deliveries in a row that exhausted their retries since the last success.'),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    disabledReason: z
      .enum(WEBHOOK_DISABLED_REASONS)
      .nullable()
      .describe(
        'Why the endpoint stopped receiving events: turned off by hand, or after too many failed deliveries. `null` while enabled.',
      ),
    enabled: z.boolean(),
    events: z.array(WebhookEventTypeSchema),
    id: z.string().describe('`whk_…`'),
    lastDeliveryAt: dateTimeSchema
      .nullable()
      .describe('When a delivery last settled (succeeded or ran out of retries).'),
    secretHint: z
      .string()
      .describe('Last characters of the signing secret, to tell secrets apart.'),
    updatedAt: dateTimeSchema,
    url: z.string(),
    workspaceId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'Webhook' });

export const WebhookWithSecretSchema = WebhookSchema.extend({
  secret: z
    .string()
    .describe(
      'The signing secret (`whsec_…`). Returned only by create and rotate-secret: store it now.',
    ),
})
  .strict()
  .meta({ id: 'WebhookWithSecret' });

export const WebhookListResponseSchema = paginatedListSchema(WebhookSchema, { total: true });

export const WebhookDeliverySchema = z
  .object({
    attempts: z.number().int().min(0).describe('Attempts made so far, the first one included.'),
    createdAt: dateTimeSchema,
    deliveredAt: dateTimeSchema.nullable(),
    durationMs: z.number().int().nullable().describe('Duration of the latest attempt.'),
    error: z
      .string()
      .nullable()
      .describe('Why the latest attempt failed (HTTP status, timeout, blocked address).'),
    eventId: z.string(),
    eventType: z.enum(DELIVERY_EVENT_TYPES),
    id: z.string().describe('`whd_…`; sent as the `X-LobeHub-Delivery-Id` header.'),
    nextAttemptAt: dateTimeSchema.nullable().describe('When the next retry is due.'),
    payload: WebhookEventSchema,
    redeliveryOf: z.string().nullable().describe('The delivery this one resends.'),
    responseBody: z
      .string()
      .nullable()
      .describe('Start of the response body of the latest attempt.'),
    responseStatus: z.number().int().nullable(),
    status: z.enum(WEBHOOK_DELIVERY_STATUSES),
    webhookId: z.string(),
  })
  .strict()
  .meta({ id: 'WebhookDelivery' });

export const WebhookDeliveryListResponseSchema = paginatedListSchema(WebhookDeliverySchema, {
  total: true,
});

export type WebhookResponse = z.input<typeof WebhookSchema>;
export type WebhookDeliveryResponse = z.input<typeof WebhookDeliverySchema>;
