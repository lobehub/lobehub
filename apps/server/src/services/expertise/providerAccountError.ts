import { AgentRuntimeErrorType } from '@lobechat/types';

const ACCOUNT_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.AccountDeactivated,
  AgentRuntimeErrorType.InsufficientQuota,
  AgentRuntimeErrorType.InvalidProviderAPIKey,
  AgentRuntimeErrorType.NoAvailableProvider,
  AgentRuntimeErrorType.PermissionDenied,
]);
const ACCOUNT_ERROR_STATUSES = new Set([401, 402, 403]);

/**
 * Whether the provider refused the call because of the account behind it, not the request.
 *
 * Out of credits, a revoked key or a missing provider stays broken until the user acts, so a retry
 * only repeats the same refusal. Provider SDKs surface these either as a runtime `errorType` or,
 * when the body is not recognized (xAI's "run out of credits" 403), as a raw HTTP `status`.
 */
export const isProviderAccountError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const { errorType, status } = error as { errorType?: unknown; status?: unknown };

  return (
    (typeof errorType === 'string' && ACCOUNT_ERROR_TYPES.has(errorType)) ||
    (typeof status === 'number' && ACCOUNT_ERROR_STATUSES.has(status))
  );
};
