import { z } from 'zod';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { SignalModel } from '@/database/models/signal';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { redisService } from '@/server/services/redis';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { getInboundWebhookKind } from './kinds';
import { isVerificationEnvelope } from './kinds/mcpEvents/delivery';
import { verifyInboundWebhook } from './verification';
import { scheduleInboundWebhookWake } from './waker';

const wakeAfterDelivery = (id: string) =>
  afterUnscoped(async () => {
    try {
      await scheduleInboundWebhookWake(id);
    } catch {
      console.error('[inboundWebhook:receive] Wake enqueue failed; sweep will retry', id);
    }
  });

export interface InboundDeliveryResponse {
  body: Record<string, unknown>;
  status: 200 | 400 | 401 | 410 | 413 | 503;
}

export async function receiveInboundWebhook(
  db: LobeChatDatabase,
  input: { body: string; headers: Headers; id: string },
): Promise<InboundDeliveryResponse> {
  if (!z.uuid().safeParse(input.id).success)
    return { body: { error: 'Webhook is gone' }, status: 410 };
  if (Buffer.byteLength(input.body) > 256 * 1024)
    return { body: { error: 'Payload too large' }, status: 413 };
  let keyPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;
  const getGateKeeper = () => (keyPromise ??= KeyVaultsGateKeeper.initWithEnvKey());
  const found = await InboundWebhookModel.findForDelivery(db, input.id, getGateKeeper);
  const kind = found && getInboundWebhookKind(found.row.kind);
  if (!found || !kind) return { body: { error: 'Webhook is gone' }, status: 410 };
  const { row, secret } = found;
  if (!verifyInboundWebhook({ ...input, secret, verification: row.verification }))
    return { body: { error: 'Invalid signature' }, status: 401 };
  let body: unknown;
  try {
    body = JSON.parse(input.body);
  } catch {
    return { body: { error: 'Invalid JSON' }, status: 400 };
  }
  const verification = isVerificationEnvelope(body);
  if (!verification && row.status === 'pending')
    return { body: { error: 'Subscription not active yet' }, status: 503 };
  if (!verification && row.status === 'terminated')
    return { body: { error: 'Subscription ended' }, status: 410 };
  const gateKeeper = await getGateKeeper();
  const model = new InboundWebhookModel(db, row.userId, row.workspaceId ?? undefined, gateKeeper);
  const deliveryId = input.headers.get('webhook-id')!;
  // A duplicate verification must still echo the challenge, even after the subscription is active.
  if (!verification && !(await redisService.inboundWebhook.claimDelivery(row.id, deliveryId)))
    return { body: {}, status: 200 };
  try {
    const remoteId = input.headers.get('x-mcp-subscription-id');
    if (remoteId && remoteId !== row.state.remoteSubscriptionId)
      await model.mergeState(row.id, { remoteSubscriptionId: remoteId });
    const handled = await kind.handleDelivery({ db, model, row }, body, deliveryId);
    if (handled.status === 400 || handled.status === 410) {
      await redisService.inboundWebhook.releaseDelivery(row.id, deliveryId);
      return { body: handled.response ?? {}, status: handled.status };
    }
    if (handled.event) {
      const event = handled.event;
      const signalModel = new SignalModel(db, row.userId, row.workspaceId ?? undefined);
      const existing = await signalModel.findByExternalId(
        'mcp-events',
        `${row.id}:${event.eventId}`,
      );
      if (existing) {
        await model.recordDelivery(row.id, !event.control);
        if (existing.status === 'pending' || existing.status === 'failed')
          wakeAfterDelivery(row.id);
        return { body: {}, status: 200 };
      }
      await signalModel.record({
        agentId: row.agentId,
        externalId: `${row.id}:${event.eventId}`,
        metadata: {
          address: { webhookId: row.id },
          entryPoint: 'inboundWebhook',
          extra: { control: event.control },
        },
        occurredAt: new Date(event.timestamp),
        payload: event.data,
        scopeKey: `inbound-webhook:${row.id}`,
        source: 'mcp-events',
        type: event.name,
      });
      if (event.cursor !== undefined)
        await model.mergeStateIf(row.id, { cursor: event.cursor }, { cursor: row.state.cursor });
      if (event.control === 'gap') await model.mergeState(row.id, { truncated: true });
      await model.recordDelivery(row.id, !event.control);
      // Queue publication happens after the response. A slow queue cannot make a
      // persisted delivery miss the server's acknowledgement deadline; sweep repairs failures.
      wakeAfterDelivery(row.id);
    }
    return { body: handled.response ?? {}, status: handled.status ?? 200 };
  } catch {
    await redisService.inboundWebhook.releaseDelivery(row.id, deliveryId);
    console.error('[inboundWebhook:receive] Failed to persist or schedule delivery', row.id);
    return { body: { error: 'Delivery temporarily unavailable' }, status: 503 };
  }
}
