import { isSSRFBlockedError, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import {
  WEBHOOK_DELIVERY_POLICY,
  WEBHOOK_HEADERS,
  WEBHOOK_TEST_EVENT_TYPE,
  webhookRetryDelaySeconds,
} from '@lobechat/types';
import debug from 'debug';

import {
  type WebhookAttemptResult,
  WebhookDeliveryWorkerModel,
} from '@/database/models/developerWebhook';
import type { WebhookDeliveryRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { openWebhookSecret } from './secretVault';
import { signWebhookPayload } from './signature';

const log = debug('lobe-server:developer-webhook:deliver');

export type WebhookDeliveryOutcome =
  | { delivery: WebhookDeliveryRow; outcome: 'succeeded' }
  | { delaySeconds: number; delivery: WebhookDeliveryRow; outcome: 'retry' }
  | { delivery: WebhookDeliveryRow; endpointDisabled: boolean; outcome: 'failed' }
  | { outcome: 'skipped'; reason: 'already_settled' | 'endpoint_disabled' | 'not_found' };

interface SendResult extends WebhookAttemptResult {
  /** A retry cannot succeed (e.g. the URL resolves to a private address). */
  permanent: boolean;
}

const readCappedText = async (response: Response) => {
  try {
    const text = await response.text();
    return text.slice(0, WEBHOOK_DELIVERY_POLICY.maxResponseBodyBytes);
  } catch {
    return null;
  }
};

/** POST one signed request; every outcome, a thrown error included, becomes a result. */
const send = async (
  url: string,
  secret: string,
  delivery: Pick<WebhookDeliveryRow, 'eventId' | 'eventType' | 'id' | 'payload'>,
): Promise<SendResult> => {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  try {
    // Only the SSRF-filtering fetch may reach a developer-supplied URL.
    const response = await ssrfSafeFetch(
      url,
      {
        body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LobeHub-Webhooks/1.0',
          [WEBHOOK_HEADERS.deliveryId]: delivery.id,
          [WEBHOOK_HEADERS.eventId]: delivery.eventId,
          [WEBHOOK_HEADERS.eventType]: delivery.eventType,
          [WEBHOOK_HEADERS.signature]: signWebhookPayload(secret, timestamp, body),
          [WEBHOOK_HEADERS.timestamp]: String(timestamp),
        },
        method: 'POST',
        // A redirect would re-send the signed body to a URL the owner never registered.
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_DELIVERY_POLICY.timeoutMs),
      },
      { maxContentLength: WEBHOOK_DELIVERY_POLICY.maxResponseBodyBytes },
    );
    const responseBody = await readCappedText(response);
    const ok = response.status >= 200 && response.status < 300;
    return {
      durationMs: elapsed(),
      error: ok ? null : `HTTP ${response.status}`,
      permanent: false,
      responseBody,
      responseStatus: response.status,
    };
  } catch (error) {
    const durationMs = elapsed();
    if (isSSRFBlockedError(error))
      return {
        durationMs,
        error: 'Blocked: the URL resolves to a private or reserved address',
        permanent: true,
        responseBody: null,
        responseStatus: null,
      };
    const name = (error as { name?: string })?.name;
    const timedOut =
      name === 'TimeoutError' ||
      name === 'AbortError' ||
      (error instanceof Error && /timeout|aborted/i.test(error.message));
    return {
      durationMs,
      error: timedOut
        ? `Timed out after ${WEBHOOK_DELIVERY_POLICY.timeoutMs} ms`
        : error instanceof Error
          ? error.message.slice(0, 500)
          : 'Request failed',
      permanent: false,
      responseBody: null,
      responseStatus: null,
    };
  }
};

/**
 * Make the next attempt of one delivery and record it. A failed attempt is retried
 * with exponential backoff (`webhookRetryDelaySeconds`) until `maxAttempts`; the
 * caller schedules the retry from the returned `delaySeconds`. A delivery that
 * exhausts its retries counts against its endpoint, which is disabled after
 * `disableAfterConsecutiveFailures` such deliveries in a row.
 *
 * Test deliveries make one attempt and never touch the endpoint's failure count.
 * Safe to call twice for the same attempt: a settled delivery is skipped.
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
  const attempts = delivery.attempts + 1;

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

  const secret = await openWebhookSecret(endpoint.secret);
  const { permanent, ...result } = await send(endpoint.url, secret, delivery);
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
