import { AgentRuntimeErrorType } from '@lobechat/types';

import { matchErrorPattern } from '../errors';

/**
 * Returns true when `message` looks like an account-level insufficient-balance
 * / billing-quota-exhausted error. The substring registry lives in
 * `errors/patterns.ts` (search for `InsufficientQuota`).
 *
 * @deprecated Prefer `ErrorClassifier.isInsufficientQuota(message)` from
 * `@lobechat/model-runtime`, or `matchErrorPattern({ message })?.code` for
 * one-off classification.
 */
export const isInsufficientQuotaError = (message?: string): boolean => {
  if (!message) return false;
  return matchErrorPattern({ message })?.code === AgentRuntimeErrorType.InsufficientQuota;
};
