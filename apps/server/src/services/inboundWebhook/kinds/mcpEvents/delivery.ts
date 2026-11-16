import { isRecord } from '@lobechat/utils/object';
import { z } from 'zod';

import type { DeliveryResult, InboundWebhookContext } from '../types';

const record = z.record(z.string(), z.unknown());
const occurrence = z.object({
  cursor: z.string().nullable().optional(),
  data: record,
  eventId: z.string().min(1),
  name: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
});
const control = z.discriminatedUnion('type', [
  z.object({ type: z.literal('verification'), challenge: z.string().min(1) }),
  z.object({ type: z.literal('gap'), cursor: z.string().nullable() }),
  z.object({
    type: z.literal('terminated'),
    error: z.object({ code: z.number(), message: z.string(), data: record.optional() }),
  }),
]);

export async function handleMcpEventDelivery(
  ctx: InboundWebhookContext,
  body: unknown,
  deliveryId: string,
): Promise<DeliveryResult> {
  if (
    isRecord(body) &&
    Object.hasOwn(body, 'type') &&
    !['verification', 'gap', 'terminated'].includes(String(body.type))
  ) {
    // A future signed control envelope must never fall through as an occurrence.
    // Log only routing metadata, not the untrusted body or discriminator value.
    console.warn('[inboundWebhook:delivery] Ignored unknown MCP control envelope', ctx.row.id);
    return { status: 200 };
  }
  const envelope = control.safeParse(body);
  if (envelope.success) {
    const value = envelope.data;
    if (value.type === 'verification') return { response: { challenge: value.challenge } };
    // Controls use webhook-id as their stable id and travel through the same durable wake path.
    return {
      event: {
        control: value.type,
        ...(value.type === 'gap' ? { cursor: value.cursor } : {}),
        data: value,
        eventId: deliveryId,
        name: ctx.row.config.eventName,
        timestamp: new Date().toISOString(),
      },
    };
  }
  if (isRecord(body) && Object.hasOwn(body, 'type'))
    return { status: 400, response: { error: 'Invalid control envelope' } };
  const event = occurrence.safeParse(body);
  if (!event.success) return { status: 400, response: { error: 'Invalid event envelope' } };
  if (event.data.name !== ctx.row.config.eventName)
    return { status: 410, response: { error: 'Event does not match this subscription' } };
  return { event: event.data };
}

export const isVerificationEnvelope = (body: unknown): boolean => {
  const result = control.safeParse(body);
  return result.success && result.data.type === 'verification';
};
