import { z } from 'zod';

/** SEP-3415 is isolated here until the SDK exposes its events extension. */
export const MCP_EVENTS_EXTENSION_ID = 'io.modelcontextprotocol/events';
export const MCP_EVENTS_CLIENT_CAPABILITIES = { extensions: { [MCP_EVENTS_EXTENSION_ID]: {} } };

const record = z.record(z.string(), z.unknown());

/**
 * An optional response field that may also arrive as `null`, read as absent.
 *
 * The SEP marks these fields optional, and servers that serialize unset values as `null` (the Go
 * reference server does, e.g. `lastDeliveryAt` before the first successful delivery) are common.
 * Rejecting them turned a subscription the server had accepted into a failed one.
 */
const absent = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const McpEventTypeSchema = z.looseObject({
  name: z.string().min(1),
  description: absent(z.string()),
  title: absent(z.string()),
  delivery: z.array(z.string()),
  inputSchema: absent(record),
  payloadSchema: absent(record),
});
export const McpListEventsResultSchema = z.looseObject({
  resultType: absent(z.literal('complete')),
  events: z.array(McpEventTypeSchema),
  nextCursor: absent(z.string()),
});
export const McpSubscribeEventParamsSchema = z.looseObject({
  name: z.string().min(1),
  arguments: record.optional(),
  delivery: z.object({ mode: z.literal('webhook'), url: z.url(), secret: z.string() }),
  cursor: z.string().nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().optional(),
  ttlMs: z.number().int().nonnegative().nullable().optional(),
});
const McpDeliveryStatusSchema = z.object({
  active: absent(z.boolean()),
  failedSince: absent(z.string()),
  lastDeliveryAt: absent(z.string()),
  // `null` is meaningful here: the SEP uses it for a subscription with no delivery error.
  lastError: z.string().nullable().optional(),
  retryAfterMs: absent(z.number()),
  throttled: absent(z.boolean()),
});
export const McpSubscribeEventResultSchema = z.looseObject({
  resultType: absent(z.literal('complete')),
  id: z.string(),
  refreshBefore: z.iso.datetime({ offset: true }).nullable(),
  cursor: z.string().nullable().optional(),
  truncated: absent(z.boolean()),
  // Advisory only. A delivery status the client cannot read must not fail a subscription the
  // server accepted, so an unreadable one is dropped rather than rejected.
  deliveryStatus: absent(McpDeliveryStatusSchema).catch(undefined),
});
export const McpUnsubscribeEventParamsSchema = z.looseObject({
  name: z.string().min(1),
  arguments: record.optional(),
  delivery: z.object({ mode: z.literal('webhook'), url: z.url() }),
});
export const McpUnsubscribeEventResultSchema = z.looseObject({
  resultType: z.literal('complete').optional(),
});

export type McpEventType = z.infer<typeof McpEventTypeSchema>;
export type McpSubscribeEventParams = z.infer<typeof McpSubscribeEventParamsSchema>;
export type McpSubscribeEventResult = z.infer<typeof McpSubscribeEventResultSchema>;
export type McpUnsubscribeEventParams = z.infer<typeof McpUnsubscribeEventParamsSchema>;
