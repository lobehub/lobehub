import { z } from 'zod';

/** SEP-3415 is isolated here until the SDK exposes its events extension. */
export const MCP_EVENTS_EXTENSION_ID = 'io.modelcontextprotocol/events';
export const MCP_EVENTS_CLIENT_CAPABILITIES = { extensions: { [MCP_EVENTS_EXTENSION_ID]: {} } };

const record = z.record(z.string(), z.unknown());
export const McpEventTypeSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().optional(),
  title: z.string().optional(),
  delivery: z.array(z.string()),
  inputSchema: record.optional(),
  payloadSchema: record.optional(),
});
export const McpListEventsResultSchema = z.looseObject({
  resultType: z.literal('complete').optional(),
  events: z.array(McpEventTypeSchema),
  nextCursor: z.string().optional(),
});
export const McpSubscribeEventParamsSchema = z.looseObject({
  name: z.string().min(1),
  arguments: record.optional(),
  delivery: z.object({ mode: z.literal('webhook'), url: z.url(), secret: z.string() }),
  cursor: z.string().nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().optional(),
  ttlMs: z.number().int().nonnegative().nullable().optional(),
});
export const McpSubscribeEventResultSchema = z.looseObject({
  resultType: z.literal('complete').optional(),
  id: z.string(),
  refreshBefore: z.iso.datetime({ offset: true }).nullable(),
  cursor: z.string().nullable().optional(),
  truncated: z.boolean().optional(),
  deliveryStatus: z
    .looseObject({
      active: z.boolean().optional(),
      failedSince: z.string().optional(),
      lastDeliveryAt: z.string().optional(),
      lastError: z.string().nullable().optional(),
      retryAfterMs: z.number().optional(),
      throttled: z.boolean().optional(),
    })
    .optional(),
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
