import type { WebhookEventData, WebhookEventEnvelope, WebhookEventType } from '@lobechat/types';
import debug from 'debug';

import { WebhookEndpointModel } from '@/database/models/developerWebhook';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';
import { DeveloperWebhookWorkflow } from '@/server/workflows/developerWebhook';

const log = debug('lobe-server:developer-webhook:emit');

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
  const model = new WebhookEndpointModel(db, scope.userId, scope.workspaceId);
  const endpoints = await model.findSubscribed(type);
  if (endpoints.length === 0) return [];

  const envelope: WebhookEventEnvelope<T> = {
    createdAt: new Date().toISOString(),
    data,
    id: idGenerator('webhookEvents', 16),
    type,
    workspaceId: scope.workspaceId ?? null,
  };

  const ids: string[] = [];
  for (const endpoint of endpoints) {
    const delivery = await model.createDelivery(endpoint, envelope as WebhookEventEnvelope);
    await DeveloperWebhookWorkflow.triggerDeliver({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
    });
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
