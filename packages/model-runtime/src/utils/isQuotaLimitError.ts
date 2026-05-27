import { AgentRuntimeErrorType } from '@lobechat/types';

import { matchErrorPattern } from '../errors';

/**
 * Returns true when `message` looks like a short-window rate-limit / quota
 * error (429-class). The substring registry lives in `errors/patterns.ts`
 * (search for `QuotaLimitReached`).
 *
 * @deprecated Prefer `ErrorClassifier.isQuotaLimitReached(message)` from
 * `@lobechat/model-runtime`, or `matchErrorPattern({ message })?.code` for
 * one-off classification.
 */
export const isQuotaLimitError = (message?: string): boolean => {
  if (!message) return false;
  return matchErrorPattern({ message })?.code === AgentRuntimeErrorType.QuotaLimitReached;
};
