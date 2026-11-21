import { isSSRFBlockedError, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { WEBHOOK_DELIVERY_POLICY, WEBHOOK_HEADERS } from '@lobechat/types';

import type { WebhookAttemptResult } from '@/database/models/developerWebhook';

import { signWebhookPayload } from './signature';

export interface SignedWebhookResult extends WebhookAttemptResult {
  /** A retry cannot succeed (e.g. the URL resolves to a private address). */
  permanent: boolean;
}

export interface SignedWebhookRequest {
  /** The raw JSON body; the signature covers exactly these bytes. */
  body: string;
  /** Identifying headers (`X-LobeHub-Event-Type` …) sent alongside the signature. */
  headers?: Record<string, string>;
  secret: string;
  url: string;
}

const readCappedText = async (response: Response) => {
  try {
    const text = await response.text();
    return text.slice(0, WEBHOOK_DELIVERY_POLICY.maxResponseBodyBytes);
  } catch {
    return null;
  }
};

/**
 * POST one signed request to a developer-supplied URL; every outcome, a thrown error
 * included, becomes a result. Shared by developer webhook deliveries and the custom
 * webhook bot channel so both sign, time out and refuse private addresses the same way.
 */
export const postSignedWebhook = async ({
  body,
  headers,
  secret,
  url,
}: SignedWebhookRequest): Promise<SignedWebhookResult> => {
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
          ...headers,
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
