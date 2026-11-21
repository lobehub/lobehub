import type { InboundWebhookItem } from '@lobechat/types';

import { isTrpcErrorCode } from '@/utils/trpcError';

import { isAutomationHealthy, resolveAutomationStatus } from './status';

export interface CheckFeedback {
  /** `setting` namespace key of the toast. */
  key: string;
  /** Interpolated into `key` as `{{reason}}` — the readable cause of a problem the check found. */
  reasonKey?: string;
  /** The row is gone on the server; drop it from the list. */
  refresh?: boolean;
  type: 'error' | 'info' | 'success' | 'warning';
}

/**
 * The toast after a check that ran. A check that finds a problem is not a
 * failure of the check (契约 3.2): the server returns the row in `error`, and
 * the toast names the cause instead of a generic "check failed".
 */
export const feedbackForCheckedItem = (item: InboundWebhookItem): CheckFeedback => {
  if (isAutomationHealthy(item)) return { key: 'automations.check.healthy', type: 'success' };

  const status = resolveAutomationStatus(item);
  return {
    key: 'automations.check.problem',
    reasonKey: status.reasonKey ?? 'automations.error.unknown',
    type: status.kind === 'active' ? 'warning' : 'error',
  };
};

/** The toast for a check the server refused (契约 3.2's thrown codes), or that never reached it. */
export const feedbackForCheckError = (error: unknown): CheckFeedback => {
  if (isTrpcErrorCode(error, 'TOO_MANY_REQUESTS'))
    return { key: 'automations.check.tooSoon', type: 'info' };
  if (isTrpcErrorCode(error, 'FORBIDDEN'))
    return { key: 'automations.actions.noPermission', type: 'error' };
  if (isTrpcErrorCode(error, 'NOT_FOUND'))
    return { key: 'automations.check.notFound', refresh: true, type: 'error' };
  if (isTrpcErrorCode(error, 'BAD_REQUEST'))
    return { key: 'automations.check.unsupported', type: 'error' };
  return { key: 'automations.check.failed', type: 'error' };
};

/** The toast for a delete the server refused. */
export const feedbackForDeleteError = (error: unknown): CheckFeedback => {
  if (isTrpcErrorCode(error, 'FORBIDDEN'))
    return { key: 'automations.actions.noPermission', type: 'error' };
  // Already gone: the list catches up and the user got what they asked for.
  if (isTrpcErrorCode(error, 'NOT_FOUND'))
    return { key: 'automations.delete.alreadyGone', refresh: true, type: 'info' };
  return { key: 'automations.delete.failed', type: 'error' };
};
