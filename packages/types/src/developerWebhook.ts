import { z } from 'zod';

/**
 * Outbound developer webhooks: events LobeHub pushes to a URL the developer registers.
 * (`inboundWebhook.ts` is the opposite direction — third parties calling into LobeHub.)
 */

/** Every event type an endpoint can subscribe to. Adding one is a type-only change. */
export const WEBHOOK_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.intervention_requested',
  'message.created',
  'topic.created',
  'task.status_changed',
  'goal.status_changed',
  'file.parsed',
  'notification.created',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Sent only by `POST /webhooks/{id}/test`; endpoints never subscribe to it. */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test' as const;
export type WebhookDeliveryEventType = WebhookEventType | typeof WEBHOOK_TEST_EVENT_TYPE;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'retrying', 'succeeded', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** Why an endpoint stopped receiving events; `null` while enabled. */
export const WEBHOOK_DISABLED_REASONS = ['manual', 'consecutive_failures'] as const;
export type WebhookDisabledReason = (typeof WEBHOOK_DISABLED_REASONS)[number];

/** Request headers on every delivery. */
export const WEBHOOK_HEADERS = {
  deliveryId: 'X-LobeHub-Delivery-Id',
  eventId: 'X-LobeHub-Event-Id',
  eventType: 'X-LobeHub-Event-Type',
  /** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>` */
  signature: 'X-LobeHub-Signature',
  /** Unix seconds the signature was computed at; reject stale ones to stop replays. */
  timestamp: 'X-LobeHub-Timestamp',
} as const;

export const WEBHOOK_SIGNATURE_VERSION = 'v1';

/** Delivery policy, shared by the sender and the docs. */
export const WEBHOOK_DELIVERY_POLICY = {
  /** Attempts per delivery, the first one included. */
  maxAttempts: 6,
  /** Delay before retry n (n >= 1) is `baseDelaySeconds * 4^(n-1)`: 30s, 2m, 8m, 32m, ~2h. */
  baseDelaySeconds: 30,
  backoffFactor: 4,
  /** Per-attempt request timeout. */
  timeoutMs: 10_000,
  /** Deliveries that exhaust their retries in a row before the endpoint is disabled. */
  disableAfterConsecutiveFailures: 5,
  /** Response body bytes kept on the delivery record. */
  maxResponseBodyBytes: 2048,
  /** Signature tolerance a receiver should apply (seconds). */
  signatureToleranceSeconds: 300,
} as const;

/** Seconds to wait before the attempt that follows `failedAttempts` failures. */
export const webhookRetryDelaySeconds = (failedAttempts: number) =>
  WEBHOOK_DELIVERY_POLICY.baseDelaySeconds *
  WEBHOOK_DELIVERY_POLICY.backoffFactor ** Math.max(0, failedAttempts - 1);

// ---------------------------------------------------------------------------
// Event payloads (the `data` of each event)
// ---------------------------------------------------------------------------

const nullableId = z.string().nullable();

export const WebhookRunEventDataSchema = z.object({
  agentId: nullableId.describe('Agent that ran'),
  runId: z.string().describe('Run id (the agent operation id)'),
  topicId: nullableId.describe('Topic the run wrote to'),
});

export const WebhookRunCompletedDataSchema = WebhookRunEventDataSchema.extend({
  assistantMessageId: nullableId.describe('Final assistant message of the run'),
  steps: z.number().int().describe('LLM calls the run made'),
});

export const WebhookRunFailedDataSchema = WebhookRunEventDataSchema.extend({
  error: z.string().nullable().describe('Error message, when the runtime recorded one'),
});

export const WebhookMessageCreatedDataSchema = z.object({
  agentId: nullableId,
  messageId: z.string(),
  role: z.string().describe('`user`, `assistant`, `tool`, …'),
  threadId: nullableId,
  topicId: nullableId,
});

export const WebhookTopicCreatedDataSchema = z.object({
  agentId: nullableId,
  title: z.string().nullable(),
  topicId: z.string(),
});

export const WebhookTaskStatusChangedDataSchema = z.object({
  identifier: z.string().nullable().describe('Human-readable task id, e.g. `T-12`'),
  previousStatus: z.string().nullable(),
  status: z.string(),
  taskId: z.string(),
});

export const WebhookGoalStatusChangedDataSchema = z.object({
  goalId: z.string(),
  previousStatus: z.string().nullable(),
  status: z.string(),
});

export const WebhookFileParsedDataSchema = z.object({
  error: z.string().nullable().describe('Why parsing failed; `null` on success'),
  fileId: z.string(),
  name: z.string().nullable(),
  status: z.enum(['success', 'error']),
});

export const WebhookNotificationCreatedDataSchema = z.object({
  category: z.string(),
  notificationId: z.string(),
  title: z.string().nullable(),
  type: z.string(),
});

export const WebhookTestDataSchema = z.object({
  message: z.string(),
  webhookId: z.string(),
});

export const WEBHOOK_EVENT_DATA_SCHEMAS = {
  'file.parsed': WebhookFileParsedDataSchema,
  'goal.status_changed': WebhookGoalStatusChangedDataSchema,
  'message.created': WebhookMessageCreatedDataSchema,
  'notification.created': WebhookNotificationCreatedDataSchema,
  'run.completed': WebhookRunCompletedDataSchema,
  'run.failed': WebhookRunFailedDataSchema,
  'run.intervention_requested': WebhookRunEventDataSchema,
  'run.started': WebhookRunEventDataSchema,
  'task.status_changed': WebhookTaskStatusChangedDataSchema,
  'topic.created': WebhookTopicCreatedDataSchema,
  'webhook.test': WebhookTestDataSchema,
} as const satisfies Record<WebhookDeliveryEventType, z.ZodType>;

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookDeliveryEventType, string> = {
  'file.parsed': 'A file finished parsing into chunks (successfully or not).',
  'goal.status_changed': 'A goal moved to another status.',
  'message.created': 'A message was written to a conversation.',
  'notification.created': 'An inbox notification was created for the owner.',
  'run.completed': 'An agent run finished.',
  'run.failed': 'An agent run ended with an error.',
  'run.intervention_requested':
    'An agent run paused for a person: a tool call waits for approval or an answer.',
  'run.started': 'An agent run started.',
  'task.status_changed': 'A task moved to another status.',
  'topic.created': 'A conversation topic was created.',
  'webhook.test': 'Sent by `POST /webhooks/{id}/test` to check an endpoint.',
};

export type WebhookEventData<T extends WebhookDeliveryEventType> = z.infer<
  (typeof WEBHOOK_EVENT_DATA_SCHEMAS)[T]
>;

/** The JSON body of every delivery. */
export interface WebhookEventEnvelope<
  T extends WebhookDeliveryEventType = WebhookDeliveryEventType,
> {
  /** ISO-8601 time the event happened. */
  createdAt: string;
  data: WebhookEventData<T>;
  /** `evt_…`; stays the same across retries and redeliveries — dedupe on it. */
  id: string;
  type: T;
  /** Workspace the event happened in; `null` for a personal space. */
  workspaceId: string | null;
}
