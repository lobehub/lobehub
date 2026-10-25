import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { getErrorCodeSpec } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, type ChatMessageError } from '@lobechat/types';

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
 *   accounts are limited or down. When the provider is unknown they go on it too,
 *   so a lost provider can never hide an outage of ours.
 *
 * `provider` is the operation's configured provider — the one the board shows.
 * The normalized error's `body.provider` is not a substitute: for our provider it
 * names the upstream the router reached (`azure`, `google`, …), never ours.
 *
 * `error` is the normalized error on the final state. Its own classification is
 * used only when `errorType` has no spec: a platform admission refusal keeps the
 * numeric `Forbidden` type (the chat renderer picks its card from it), so the
 * normalizer classifies it on the error itself and the spec lookup alone would
 * file every plan-gate and onboarding-gate refusal as an unknown failure.
 */
export const shouldRecordGatewayError = ({
  error,
  errorType,
  provider,
}: {
  error?: Pick<ChatMessageError, 'attribution' | 'countAsFailure'>;
  errorType?: string;
  provider?: string;
}): boolean => {
  if (!errorType || HARNESS_SIGNAL_ERROR_TYPES.has(errorType)) return true;

  const spec =
    getErrorCodeSpec(errorType) ??
    (typeof error?.countAsFailure === 'boolean' && error.attribution
      ? { attribution: error.attribution, countAsFailure: error.countAsFailure }
      : undefined);
  if (!spec || spec.countAsFailure) return true;

  switch (spec.attribution) {
    case 'user': {
      return false;
    }
    case 'provider': {
      return !provider || provider === BRANDING_PROVIDER;
    }
    default: {
      return true;
    }
  }
};
