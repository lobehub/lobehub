import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

/** Runtime error types that mean "this model or route cannot do a forced tool call". */
const TOOL_CAPABILITY_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.CapabilityNotSupported,
  AgentRuntimeErrorType.InvalidRequestFormat,
  AgentRuntimeErrorType.UpstreamMalformedResponse,
]);

/** Catch-all provider buckets whose message must name tools to count as a capability error. */
const GENERIC_PROVIDER_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.ProviderBizError,
  AgentRuntimeErrorType.UpstreamHttpError,
]);

const TOOL_CAPABILITY_MESSAGE = /tool|function[\s_-]?call/i;

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (!isRecord(error)) return String(error);
  try {
    return JSON.stringify(error.error ?? error.message ?? error);
  } catch {
    return '';
  }
};

/**
 * Whether a failed forced-tool-call request failed because the model or route does not support
 * tool calling, so JSON-schema mode may still succeed.
 *
 * Auth, quota, budget, rate-limit, network, and other provider failures are not capability
 * errors: retrying them in another mode would only repeat the failure (and its cost), so they
 * propagate.
 */
export const isToolCapabilityError = (error: unknown): boolean => {
  const errorType = isRecord(error) && typeof error.errorType === 'string' ? error.errorType : '';
  if (errorType) {
    if (TOOL_CAPABILITY_ERROR_TYPES.has(errorType)) return true;
    if (GENERIC_PROVIDER_ERROR_TYPES.has(errorType)) {
      return TOOL_CAPABILITY_MESSAGE.test(describeError(error));
    }
    return false;
  }
  return TOOL_CAPABILITY_MESSAGE.test(describeError(error));
};
