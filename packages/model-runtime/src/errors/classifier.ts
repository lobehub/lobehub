import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';

import { matchErrorPattern } from './match';

const matches = (message: string | undefined, code: ILobeAgentRuntimeErrorType): boolean => {
  if (!message) return false;
  return matchErrorPattern({ message })?.code === code;
};

/**
 * Discoverable namespace object that bundles all upstream-message predicates.
 *
 * Prefer this over the standalone `is*Error` utilities — they're kept as
 * `@deprecated` shims for backward compatibility. New code should import from
 * here:
 *
 * ```ts
 * import { ErrorClassifier } from '@lobechat/model-runtime';
 * if (ErrorClassifier.isExceededContextWindow(message)) { ... }
 * ```
 *
 * For one-off classification or any code that isn't on this list, drop down
 * to `matchErrorPattern({ message })?.code` directly — it returns the same
 * info but with the full code as the discriminator.
 */
export const ErrorClassifier = {
  /** Account-level balance / billing quota exhausted. */
  isInsufficientQuota: (message?: string): boolean =>
    matches(message, AgentRuntimeErrorType.InsufficientQuota),

  /** Short-window rate limit (RPM / TPM / concurrency). Transient, retryable. */
  isRateLimitExceeded: (message?: string): boolean =>
    matches(message, AgentRuntimeErrorType.RateLimitExceeded),

  /** @deprecated Renamed to `isRateLimitExceeded`. */
  isQuotaLimitReached: (message?: string): boolean =>
    matches(message, AgentRuntimeErrorType.RateLimitExceeded),

  /** Prompt + tool payload exceeds the model context window. */
  isExceededContextWindow: (message?: string): boolean =>
    matches(message, AgentRuntimeErrorType.ExceededContextWindow),

  /** Provider account suspended or deactivated. */
  isAccountDeactivated: (message?: string): boolean =>
    matches(message, AgentRuntimeErrorType.AccountDeactivated),
};

export type ErrorClassifierType = typeof ErrorClassifier;
