import { z } from 'zod';

import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { SignalModel } from '@/database/models/signal';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { redisService } from '@/server/services/redis';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import { getInboundWebhookKind } from './kinds';
import type { InboundDeliveryStatus } from './kinds/types';
import { DELIVERIES_PER_MINUTE_PER_MEMBER, deliveryScopeOf } from './limits';
import { scheduleInboundWebhookWake } from './scheduler';

export const INBOUND_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

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
  /** Seconds a rate-limited caller should wait (`Retry-After`). */
  retryAfter?: number;
  status: InboundDeliveryStatus;
}

export interface InboundDeliveryInput {
  body: string;
  headers: Headers;
  id: string;
  /** The `:token` segment of `/inbound/:id/:token`. */
  query?: URLSearchParams;
  /** A test delivery from the management page; it skips the ingress rate limit. */
  test?: boolean;
}

/** Deliveries per minute the row's scope accepts: per member of a workspace, one personal space. */
const deliveryLimitOf = async (
  db: LobeChatDatabase,
  row: { userId: string; workspaceId: string | null },
) => {
  const { workspaceId } = row;
  if (!workspaceId) return DELIVERIES_PER_MINUTE_PER_MEMBER;
  const members = await redisService.inboundWebhook.workspaceMemberCount(workspaceId, () =>
    InboundWebhookModel.activeMemberCount(db, workspaceId),
  );
  return DELIVERIES_PER_MINUTE_PER_MEMBER * Math.max(1, members);
};

export async function receiveInboundWebhook(
  db: LobeChatDatabase,
  input: InboundDeliveryInput,
): Promise<InboundDeliveryResponse> {
  if (!z.uuid().safeParse(input.id).success)
    return { body: { error: 'Webhook is gone' }, status: 410 };
  if (Buffer.byteLength(input.body) > INBOUND_WEBHOOK_MAX_BODY_BYTES)
    return { body: { error: 'Payload too large' }, status: 413 };
  let keyPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;
  const getGateKeeper = () => (keyPromise ??= KeyVaultsGateKeeper.initWithEnvKey());
  const found = await InboundWebhookModel.findForDelivery(db, input.id, getGateKeeper);
  const kind = found && getInboundWebhookKind(found.row.kind);
  if (!found || !kind) return { body: { error: 'Webhook is gone' }, status: 410 };
  const { row, secret } = found;
  const request = {
    body: input.body,
    headers: input.headers,
    query: input.query ?? new URLSearchParams(),
    test: input.test,
  };
  if (!kind.verify({ request, row, secret }))
    return { body: { error: 'Invalid signature' }, status: 401 };
  // Checked once the caller has proven it holds the secret, so a stranger cannot spend the quota.
  // One allowance per scope (workspace or personal space), shared by all its webhooks and kinds.
  if (!input.test) {
    const used = await redisService.inboundWebhook.countDelivery(deliveryScopeOf(row));
    if (used !== undefined && used > (await deliveryLimitOf(db, row)))
      return { body: { error: 'Too many requests' }, retryAfter: 60, status: 429 };
  }
  const gateKeeper = await getGateKeeper();
  const model = new InboundWebhookModel(db, row.userId, row.workspaceId ?? undefined, gateKeeper);
  try {
    const handled = await kind.parseDelivery({ db, model, row }, request);
    if (handled.status && handled.status !== 200)
      return { body: handled.response ?? {}, status: handled.status };
    if (!handled.event) return { body: handled.response ?? {}, status: 200 };
    const event = handled.event;
    const signalModel = new SignalModel(db, row.userId, row.workspaceId ?? undefined);
    const externalId = `${row.id}:${event.eventId}`;
    const existing = await signalModel.findByExternalId(kind.signalSource, externalId);
    if (existing) {
      await model.recordDelivery(row.id, !event.control);
      if (existing.status === 'pending' || existing.status === 'failed') wakeAfterDelivery(row.id);
      return kind.acknowledge?.(existing, true) ?? { body: {}, status: 200 };
    }
    // The ledger's unique (source, external_id) constraint arbitrates concurrent writers.
    // A Redis claim is not evidence of persistence and must never justify an acknowledgement.
    const persisted = await signalModel.record({
      agentId: row.agentId,
      externalId,
      metadata: {
        address: { ...event.address, webhookId: row.id },
        entryPoint: 'inboundWebhook',
        extra: { ...event.extra, control: event.control },
      },
      occurredAt: new Date(event.timestamp),
      payload: event.data,
      scopeKey: `inbound-webhook:${row.id}`,
      source: kind.signalSource,
      type: event.name,
    });
    if (!persisted) throw new Error('Signal could not be persisted');
    await kind.onPersisted?.({ db, model, row }, event);
    await model.recordDelivery(row.id, !event.control);
    // Queue publication happens after the response. A slow queue cannot make a
    // persisted delivery miss the server's acknowledgement deadline; sweep repairs failures.
    if (persisted.status === 'pending' || persisted.status === 'failed') wakeAfterDelivery(row.id);
    return (
      kind.acknowledge?.(persisted, false) ?? {
        body: handled.response ?? {},
        status: handled.status ?? 200,
      }
    );
  } catch {
    console.error('[inboundWebhook:receive] Failed to persist or schedule delivery', row.id);
    return { body: { error: 'Delivery temporarily unavailable' }, status: 503 };
  }
}
