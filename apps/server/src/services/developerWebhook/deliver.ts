import {
  WEBHOOK_DELIVERY_POLICY,
  WEBHOOK_HEADERS,
  WEBHOOK_TEST_EVENT_TYPE,
  webhookRetryDelaySeconds,
} from '@lobechat/types';
import debug from 'debug';

import { WebhookDeliveryWorkerModel } from '@/database/models/developerWebhook';
import type { WebhookDeliveryRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { openWebhookSecret, WebhookSecretUnavailableError } from './secretVault';
import { postSignedWebhook, type SignedWebhookResult } from './send';

const log = debug('lobe-server:developer-webhook:deliver');

/** A scheduled retry may arrive this much before its `nextAttemptAt` (queue clock skew). */
const RETRY_EARLY_SLACK_MS = 5000;

export type WebhookDeliveryOutcome =
  | { delivery: WebhookDeliveryRow; outcome: 'succeeded' }
  | { delaySeconds: number; delivery: WebhookDeliveryRow; outcome: 'retry' }
  | { delivery: WebhookDeliveryRow; endpointDisabled: boolean; outcome: 'failed' }
  | {
      outcome: 'skipped';
      reason: 'already_claimed' | 'already_settled' | 'endpoint_disabled' | 'not_due' | 'not_found';
    };

type SendResult = SignedWebhookResult;

/** POST one signed delivery; every outcome, a thrown error included, becomes a result. */
const send = async (
  url: string,
  secret: string,
  delivery: Pick<WebhookDeliveryRow, 'eventId' | 'eventType' | 'id' | 'payload'>,
): Promise<SendResult> =>
  postSignedWebhook({
    body: JSON.stringify(delivery.payload),
    headers: {
      [WEBHOOK_HEADERS.deliveryId]: delivery.id,
      [WEBHOOK_HEADERS.eventId]: delivery.eventId,
      [WEBHOOK_HEADERS.eventType]: delivery.eventType,
    },
    secret,
    url,
  });

/**
 * Make the next attempt of one delivery and record it. A failed attempt is retried
 * with exponential backoff (`webhookRetryDelaySeconds`) until `maxAttempts`; the
 * caller schedules the retry from the returned `delaySeconds`. A delivery that
 * exhausts its retries counts against its endpoint, which is disabled after
 * `disableAfterConsecutiveFailures` such deliveries in a row.
 *
 * Test deliveries make one attempt and never touch the endpoint's failure count.
 * Safe to call twice for the same attempt (queues deliver at least once): each
 * attempt is claimed first, and a settled or already-claimed delivery is skipped.
 */
export const attemptWebhookDelivery = async (
  db: LobeChatDatabase,
  deliveryId: string,
): Promise<WebhookDeliveryOutcome> => {
  const worker = new WebhookDeliveryWorkerModel(db);
  const row = await worker.load(deliveryId);
  if (!row) return { outcome: 'skipped', reason: 'not_found' };

  const { delivery, endpoint } = row;
  if (delivery.status === 'succeeded' || delivery.status === 'failed')
    return { outcome: 'skipped', reason: 'already_settled' };

  const isTest = delivery.eventType === WEBHOOK_TEST_EVENT_TYPE;

  // A retry is only due at `nextAttemptAt`; a late duplicate of the previous attempt's
  // queue message must not send it early (the scheduled one will).
  if (
    delivery.status === 'retrying' &&
    delivery.nextAttemptAt &&
    delivery.nextAttemptAt.getTime() - Date.now() > RETRY_EARLY_SLACK_MS
  )
    return { outcome: 'skipped', reason: 'not_due' };

  if (!endpoint.enabled && !isTest) {
    await worker.recordAttempt(deliveryId, {
      attempts: delivery.attempts,
      durationMs: null,
      error: 'Endpoint is disabled',
      nextAttemptAt: null,
      responseBody: null,
      responseStatus: null,
      status: 'failed',
    });
    return { outcome: 'skipped', reason: 'endpoint_disabled' };
  }

  const attempts = await worker.claimAttempt(deliveryId, delivery.attempts);
  if (attempts === null) return { outcome: 'skipped', reason: 'already_claimed' };

  let sent: SendResult;
  try {
    sent = await send(endpoint.url, await openWebhookSecret(endpoint.secret), delivery);
  } catch (error) {
    // Nothing reached the receiver, and retrying will not change that: settle the
    // delivery as failed instead of leaving it claimed with nothing to resume it.
    sent = {
      durationMs: null,
      error:
        error instanceof WebhookSecretUnavailableError
          ? error.message
          : `Delivery failed before sending: ${(error as Error)?.message ?? 'unknown error'}`,
      permanent: true,
      responseBody: null,
      responseStatus: null,
    };
  }
  const { permanent, ...result } = sent;
  const ok = result.responseStatus !== null && result.error === null;

  if (ok) {
    await worker.recordAttempt(deliveryId, {
      ...result,
      attempts,
      nextAttemptAt: null,
      status: 'succeeded',
    });
    if (!isTest) await worker.markEndpointSucceeded(endpoint.id);
    log('delivery %s succeeded on attempt %d (%d)', deliveryId, attempts, result.responseStatus);
    return {
      delivery: { ...delivery, ...result, attempts, status: 'succeeded' },
      outcome: 'succeeded',
    };
  }

  const canRetry = !isTest && !permanent && attempts < WEBHOOK_DELIVERY_POLICY.maxAttempts;
  if (canRetry) {
    const delaySeconds = webhookRetryDelaySeconds(attempts);
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
    await worker.recordAttempt(deliveryId, {
      ...result,
      attempts,
      nextAttemptAt,
      status: 'retrying',
    });
    log(
      'delivery %s attempt %d failed (%s); retry in %ds',
      deliveryId,
      attempts,
      result.error,
      delaySeconds,
    );
    return {
      delaySeconds,
      delivery: { ...delivery, ...result, attempts, nextAttemptAt, status: 'retrying' },
      outcome: 'retry',
    };
  }

  await worker.recordAttempt(deliveryId, {
    ...result,
    attempts,
    nextAttemptAt: null,
    status: 'failed',
  });
  const endpointDisabled = isTest
    ? false
    : await worker.markEndpointFailed(
        endpoint.id,
        WEBHOOK_DELIVERY_POLICY.disableAfterConsecutiveFailures,
      );
  log(
    'delivery %s failed after %d attempt(s); endpoint disabled=%s',
    deliveryId,
    attempts,
    endpointDisabled,
  );
  return {
    delivery: { ...delivery, ...result, attempts, status: 'failed' },
    endpointDisabled,
    outcome: 'failed',
  };
};
