import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { WebhookDeliveryWorkerModel } from '@/database/models/developerWebhook';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';
import { attemptWebhookDelivery } from '@/server/services/developerWebhook/deliver';

const log = debug('lobe-server:workflows:developer-webhook');

export interface DeveloperWebhookDeliverPayload {
  deliveryId: string;
  endpointId: string;
}

export const DEVELOPER_WEBHOOK_DELIVER_PATH = '/api/workflows/developer-webhook/deliver';

/**
 * Asynchronous delivery of developer webhooks. With the queue runtime every attempt
 * is one QStash message, published with the backoff delay of the attempt it carries;
 * without it (local dev, desktop) an in-process timer stands in for QStash, so a
 * restart drops the retries it was holding — production deployments use the queue.
 */
export class DeveloperWebhookWorkflow {
  static async triggerDeliver(payload: DeveloperWebhookDeliverPayload, delaySeconds = 0) {
    if (appEnv.enableQueueAgentRuntime) {
      return qstashClient.publishJSON({
        body: payload,
        delay: Math.max(0, Math.round(delaySeconds)),
        // At most a few requests in flight per endpoint, so one slow receiver cannot hog the queue.
        flowControl: { key: `developer-webhook.endpoint.${payload.endpointId}`, parallelism: 5 },
        // Attempts are counted and backed off by the handler; QStash only covers a crashed handler,
        // which the handler's settled-delivery check makes safe to repeat.
        retries: 2,
        url: new URL(
          DEVELOPER_WEBHOOK_DELIVER_PATH,
          appEnv.INTERNAL_APP_URL || appEnv.APP_URL,
        ).toString(),
      });
    }

    const timer = setTimeout(
      async () => {
        try {
          await DeveloperWebhookWorkflow.runDeliver(payload);
        } catch (error) {
          console.error('[developerWebhook:workflow] Local delivery failed', error);
        }
      },
      Math.max(0, delaySeconds) * 1000,
    );
    timer.unref?.();
  }

  /** One attempt, then the next one scheduled when it failed and may be retried. */
  static async runDeliver(payload: DeveloperWebhookDeliverPayload) {
    const result = await attemptWebhookDelivery(await getServerDB(), payload.deliveryId);
    if (result.outcome === 'retry') {
      log('schedule retry of %s in %ds', payload.deliveryId, result.delaySeconds);
      try {
        await DeveloperWebhookWorkflow.triggerDeliver(payload, result.delaySeconds);
      } catch (error) {
        // Nothing would ever send the retry: settle the delivery instead of leaving it waiting.
        console.error(
          '[developerWebhook:workflow] cannot schedule retry',
          payload.deliveryId,
          error,
        );
        await new WebhookDeliveryWorkerModel(await getServerDB()).recordAttempt(
          payload.deliveryId,
          {
            attempts: result.delivery.attempts,
            durationMs: result.delivery.durationMs,
            error: 'Could not schedule the retry',
            nextAttemptAt: null,
            responseBody: result.delivery.responseBody,
            responseStatus: result.delivery.responseStatus,
            status: 'failed',
          },
        );
      }
    }
    return result;
  }
}
