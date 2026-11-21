import { type WebhookDeliveryItem, type WebhookEndpointItem } from '@lobechat/types';

/**
 * What the list says about an endpoint:
 * - `active`: enabled and the last deliveries went through;
 * - `failing`: enabled, but recent deliveries exhausted their retries;
 * - `paused`: turned off by its owner;
 * - `autoDisabled`: LobeHub turned it off after too many failures in a row.
 */
export type WebhookEndpointStatus = 'active' | 'autoDisabled' | 'failing' | 'paused';

export const resolveEndpointStatus = (
  endpoint: Pick<WebhookEndpointItem, 'consecutiveFailures' | 'disabledReason' | 'enabled'>,
): WebhookEndpointStatus => {
  if (!endpoint.enabled)
    return endpoint.disabledReason === 'consecutive_failures' ? 'autoDisabled' : 'paused';
  return endpoint.consecutiveFailures > 0 ? 'failing' : 'active';
};

/** `whsec_…abcd`: enough to tell secrets apart, never enough to use one. */
export const formatSecretHint = (hint: string) => `whsec_…${hint}`;

export interface TestOutcome {
  durationMs: number | null;
  error: string | null;
  ok: boolean;
  responseStatus: number | null;
}

/** A test attempt succeeded only when the receiver answered 2xx. */
export const resolveTestOutcome = (
  delivery: Pick<WebhookDeliveryItem, 'durationMs' | 'error' | 'responseStatus' | 'status'>,
): TestOutcome => ({
  durationMs: delivery.durationMs,
  error: delivery.error,
  ok: delivery.status === 'succeeded',
  responseStatus: delivery.responseStatus,
});
