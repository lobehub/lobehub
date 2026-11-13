import type { InboundWebhookError, InboundWebhookItem } from '@lobechat/types';

/**
 * What the user can do about an automation's current state.
 *
 * - `check`: ask the server again — the only way to resume a never-expiring
 *   subscription whose delivery the server paused.
 * - `reconnect`: the connector's credentials stopped working; nothing on this
 *   row fixes that, the connector settings do.
 * - `resubscribe`: the server ended the subscription; delete it and ask the
 *   agent to subscribe again.
 * - `none`: it recovers on its own (hourly cap) or is fixed elsewhere (credits).
 */
export type AutomationRemedy = 'check' | 'none' | 'reconnect' | 'resubscribe';

export type AutomationStatusKind = 'active' | 'deliveryError' | 'reconnect' | 'terminated';

export type AutomationTone = 'default' | 'error' | 'success' | 'warning';

export interface AutomationStatus {
  kind: AutomationStatusKind;
  /** `setting` namespace key of the status tag. */
  labelKey: string;
  /** `setting` namespace key of why it is in this state; absent when nothing is wrong. */
  reasonKey?: string;
  /** Tone of the reason line, which can differ from the tag (an active row with a skipped run). */
  reasonTone?: Exclude<AutomationTone, 'default' | 'success'>;
  remedy: AutomationRemedy;
  tone: AutomationTone;
}

/** One readable reason per `last_error` value (契约 3.1); `unknown` covers anything unmapped. */
export const automationErrorKey = (error: InboundWebhookError | string) =>
  `automations.error.${ERROR_KEYS.has(error as InboundWebhookError) ? error : 'unknown'}`;

const ERROR_KEYS = new Set<InboundWebhookError>([
  'access_revoked',
  'auth',
  'challenge_failed',
  'connection_refused',
  'delivery_suspended',
  'event_unavailable',
  'http_4xx',
  'http_5xx',
  'insufficient_budget',
  'server_unreachable',
  'timeout',
  'tls_error',
  'unknown',
  'wake_cap',
]);

const remedyFor = (error: InboundWebhookError | string): AutomationRemedy => {
  switch (error) {
    case 'auth': {
      return 'reconnect';
    }
    case 'access_revoked':
    case 'event_unavailable': {
      return 'resubscribe';
    }
    // The hourly cap lifts by itself; credits are topped up elsewhere.
    case 'wake_cap':
    case 'insufficient_budget': {
      return 'none';
    }
    default: {
      return 'check';
    }
  }
};

/**
 * The status tag, reason and remedy a row shows. Shared by the settings list
 * and the in-chat subscription result so a subscription reads the same in both.
 */
export const resolveAutomationStatus = (
  item: Pick<InboundWebhookItem, 'lastError' | 'status'>,
): AutomationStatus => {
  const { lastError, status } = item;

  if (status === 'terminated')
    return {
      kind: 'terminated',
      labelKey: 'automations.status.terminated',
      reasonKey: lastError ? automationErrorKey(lastError) : 'automations.error.terminated',
      reasonTone: 'error',
      remedy: 'resubscribe',
      tone: 'default',
    };

  if (status === 'error') {
    if (lastError === 'auth')
      return {
        kind: 'reconnect',
        labelKey: 'automations.status.reconnect',
        reasonKey: automationErrorKey('auth'),
        reasonTone: 'error',
        remedy: 'reconnect',
        tone: 'error',
      };

    const error = lastError ?? 'unknown';
    return {
      kind: 'deliveryError',
      labelKey: 'automations.status.deliveryError',
      reasonKey: automationErrorKey(error),
      reasonTone: 'error',
      remedy: remedyFor(error),
      tone: 'error',
    };
  }

  // Still delivering, but the last run was skipped or the server reported a
  // hiccup: the subscription is fine, the reason is a heads-up.
  if (lastError)
    return {
      kind: 'active',
      labelKey: 'automations.status.active',
      reasonKey: automationErrorKey(lastError),
      reasonTone: 'warning',
      remedy: remedyFor(lastError),
      tone: 'success',
    };

  return {
    kind: 'active',
    labelKey: 'automations.status.active',
    remedy: 'none',
    tone: 'success',
  };
};

/** Whether a row is delivering normally — the "subscription is healthy" answer to a check. */
export const isAutomationHealthy = (item: Pick<InboundWebhookItem, 'lastError' | 'status'>) =>
  item.status === 'active' && !item.lastError;
