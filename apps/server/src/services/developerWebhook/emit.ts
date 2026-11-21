import type { WebhookEventData, WebhookEventEnvelope, WebhookEventType } from '@lobechat/types';
import debug from 'debug';

import {
  WebhookDeliveryWorkerModel,
  WebhookEndpointModel,
} from '@/database/models/developerWebhook';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';
import { DeveloperWebhookWorkflow } from '@/server/workflows/developerWebhook';

const log = debug('lobe-server:developer-webhook:emit');

/**
 * Spaces known to have no subscribed endpoint, so the writes that announce events
 * (every message, topic, task status…) skip the endpoint lookup almost always.
 * Per process and short-lived: another instance may miss events for up to
 * `NO_ENDPOINT_TTL_MS` after an endpoint is created there.
 */
const NO_ENDPOINT_TTL_MS = 10_000;
const NO_ENDPOINT_MAX_ENTRIES = 10_000;
const noEndpointUntil = new Map<string, number>();
const scopeKey = (scope: WebhookEventScope) => `${scope.userId}:${scope.workspaceId ?? ''}`;

/** Forget the "no endpoint" note of a space after its endpoints change. */
export const invalidateWebhookScope = (scope: WebhookEventScope) => {
  noEndpointUntil.delete(scopeKey(scope));
};

/**
 * Hand one delivery to the queue. If the queue refuses it, the delivery is recorded
 * as failed instead of staying `pending` with nothing left to send it.
 */
export const dispatchWebhookDelivery = async (
  db: LobeChatDatabase,
  delivery: { endpointId: string; id: string },
): Promise<boolean> => {
  try {
    await DeveloperWebhookWorkflow.triggerDeliver({
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
    });
    return true;
  } catch (error) {
    console.error('[developerWebhook] cannot queue delivery', delivery.id, error);
    await new WebhookDeliveryWorkerModel(db).recordAttempt(delivery.id, {
      attempts: 0,
      durationMs: null,
      error: 'Could not queue the delivery',
      nextAttemptAt: null,
      responseBody: null,
      responseStatus: null,
      status: 'failed',
    });
    return false;
  }
};

export interface WebhookEventScope {
  userId: string;
  /** Workspace the event happened in; omit (or null) for a personal space. */
  workspaceId?: string | null;
}

/**
 * Queue one event for every enabled endpoint of `scope` that subscribes to `type`:
 * one delivery row per endpoint, each handed to {@link DeveloperWebhookWorkflow}.
 * Returns the delivery ids (empty when nobody subscribes, the common case).
 */
export const emitWebhookEvent = async <T extends WebhookEventType>(
  db: LobeChatDatabase,
  scope: WebhookEventScope,
  type: T,
  data: WebhookEventData<T>,
): Promise<string[]> => {
  const key = scopeKey(scope);
  if ((noEndpointUntil.get(key) ?? 0) > Date.now()) return [];

  const model = new WebhookEndpointModel(db, scope.userId, scope.workspaceId);
  const endpoints = await model.findSubscribed(type);
  if (endpoints.length === 0) {
    if (!(await model.hasEnabled())) {
      if (noEndpointUntil.size >= NO_ENDPOINT_MAX_ENTRIES) noEndpointUntil.clear();
      noEndpointUntil.set(key, Date.now() + NO_ENDPOINT_TTL_MS);
    }
    return [];
  }

  const envelope: WebhookEventEnvelope<T> = {
    createdAt: new Date().toISOString(),
    data,
    id: idGenerator('webhookEvents', 16),
    type,
    workspaceId: scope.workspaceId ?? null,
  };

  const ids: string[] = [];
  for (const endpoint of endpoints) {
    // The subscription was read outside a transaction: an endpoint that is redirected or
    // unsubscribed before this row exists is not queued at all, and one that is redirected
    // after it exists is settled by the same write that moved the URL.
    const delivery = await model.createDeliveryForSubscription(
      endpoint,
      envelope as WebhookEventEnvelope,
    );
    if (!delivery) continue;
    await dispatchWebhookDelivery(db, delivery);
    ids.push(delivery.id);
  }
  log('%s %s → %d endpoint(s)', type, envelope.id, ids.length);
  return ids;
};

/**
 * The one call event producers make. Runs after the response and never throws, so a
 * webhook problem can never fail or slow the write that produced the event.
 */
export const publishWebhookEvent = <T extends WebhookEventType>(
  db: LobeChatDatabase,
  scope: WebhookEventScope,
  type: T,
  data: WebhookEventData<T>,
): void => {
  if (!scope.userId) return;
  afterUnscoped(async () => {
    try {
      await emitWebhookEvent(db, scope, type, data);
    } catch (error) {
      console.error(`[developerWebhook] failed to publish ${type}`, error);
    }
  });
};
