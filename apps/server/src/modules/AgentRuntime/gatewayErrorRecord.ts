import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { getErrorCodeSpec } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * User-attributed codes that still point at something the harness could have
 * prevented — a context or payload the harness should have trimmed, or a request
 * shape the provider rejected. Adapter bugs hide in `InvalidRequestFormat` in
 * particular, so these stay on the board even though users see them as their own.
 */
const HARNESS_SIGNAL_ERROR_TYPES = new Set<string>([
  AgentRuntimeErrorType.ExceededContextWindow,
  AgentRuntimeErrorType.ExceededImageLimit,
  AgentRuntimeErrorType.ExceededToolLimit,
  AgentRuntimeErrorType.InvalidRequestFormat,
  AgentRuntimeErrorType.RequestBodyTooLarge,
]);

/**
 * Whether a terminal error belongs on the agent-gateway error board — the queue
 * of failures someone on our side should look at. The full error is persisted on
 * the operation either way; this only decides what the board is told about.
 *
 * - Codes that count as operational failures always go on the board.
 * - `user`-attributed codes (quota, bad key, content policy, …) stay off it.
 * - `provider`-attributed codes (rate limits, upstream outages) stay off it for a
 *   user's own provider, but go on it for ours: there they mean our upstream
 *   accounts are limited or down.
 */
export const shouldRecordGatewayError = ({
  errorType,
  provider,
}: {
  errorType?: string;
  provider?: string;
}): boolean => {
  if (!errorType || HARNESS_SIGNAL_ERROR_TYPES.has(errorType)) return true;

  const spec = getErrorCodeSpec(errorType);
  if (!spec || spec.countAsFailure) return true;

  switch (spec.attribution) {
    case 'user': {
      return false;
    }
    case 'provider': {
      return provider === BRANDING_PROVIDER;
    }
    default: {
      return true;
    }
  }
};
