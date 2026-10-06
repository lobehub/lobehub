import { TRPCError } from '@trpc/server';

/**
 * Contract failures raised while claiming an intervention, mapped to the tRPC
 * code the caller should see.
 *
 * A rejected resolution is a statement about the request, not a server fault,
 * so none of these may surface as a 500. The first group is thrown by
 * `AgentInterventionModel` in `@lobechat/database`; the rest are thrown by the
 * Cloud resolution service ahead of the model and are matched by name because
 * OSS cannot import them.
 */
const INTERVENTION_ERROR_CODES: Record<string, { code: TRPCError['code']; message: string }> = {
  AGENT_INTERVENTION_CUSTOM_CONTEXT_MISSING: {
    code: 'BAD_REQUEST',
    message: 'This interaction is missing the context needed to resolve it.',
  },
  AGENT_INTERVENTION_DETAIL_REQUIRED: {
    code: 'BAD_REQUEST',
    message: 'This interaction is missing the context needed to resolve it.',
  },
  AGENT_INTERVENTION_IDENTITY_CONFLICT: {
    code: 'CONFLICT',
    message: 'This approval was already resolved by another request.',
  },
  AGENT_INTERVENTION_INVALID_ACTION: {
    code: 'BAD_REQUEST',
    message: 'This response does not match what the agent asked for.',
  },
  AGENT_INTERVENTION_INVALID_ANSWER_KEY: {
    code: 'BAD_REQUEST',
    message: 'This response does not match what the agent asked for.',
  },
  AGENT_INTERVENTION_INVALID_BATCH: {
    code: 'BAD_REQUEST',
    message: 'This approval request is no longer valid.',
  },
  AGENT_INTERVENTION_INVALID_EDIT: {
    code: 'BAD_REQUEST',
    message: 'This response does not match what the agent asked for.',
  },
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH: {
    code: 'CONFLICT',
    message: 'The request changed since this card was rendered. Reload and try again.',
  },
  AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH: {
    code: 'BAD_REQUEST',
    message: 'This approval request is no longer valid.',
  },
  AGENT_INTERVENTION_INVALID_SELECTION: {
    code: 'BAD_REQUEST',
    message: 'This response does not match what the agent asked for.',
  },
  AGENT_INTERVENTION_INVALID_STOP_SCOPE: {
    code: 'BAD_REQUEST',
    message: 'This response does not match what the agent asked for.',
  },
  AGENT_INTERVENTION_REMEMBER_REQUIRES_ALLOW_LIST: {
    code: 'BAD_REQUEST',
    message: 'Remembering this approval is not available here.',
  },
  AGENT_INTERVENTION_REMEMBER_REQUIRES_SINGLE_ITEM: {
    code: 'BAD_REQUEST',
    message: 'Remembering this approval is not available here.',
  },
  AGENT_INTERVENTION_RESOLUTION_CONFLICT: {
    code: 'CONFLICT',
    message: 'This approval was already resolved by another request.',
  },
  AGENT_INTERVENTION_RESOLUTION_IDENTITY_MISMATCH: {
    code: 'CONFLICT',
    message: 'This approval was already resolved by another request.',
  },
  AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED: {
    code: 'CONFLICT',
    message: 'This approval was already resolved by another request.',
  },
  AGENT_INTERVENTION_REVIEW_STALE: {
    code: 'CONFLICT',
    message: 'The request changed since this card was rendered. Reload and try again.',
  },
  AGENT_INTERVENTION_REVIEW_UNAVAILABLE: {
    code: 'FORBIDDEN',
    message: 'This approval is not available to you.',
  },
  AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH: {
    code: 'CONFLICT',
    message: 'This approval was already resolved by another request.',
  },
  AGENT_INTERVENTION_STALE_BATCH: {
    code: 'CONFLICT',
    message: 'The request changed since this card was rendered. Reload and try again.',
  },
  AGENT_INTERVENTION_UNSUPPORTED_DETAIL: {
    code: 'BAD_REQUEST',
    message: 'This interaction cannot be resolved from here.',
  },
};

/**
 * Maps an intervention resolution failure to its public tRPC representation.
 *
 * Use when:
 * - A procedure claims an intervention on behalf of a Review / approval client
 *
 * Expects:
 * - An error caught from the resolution slot, including an existing tRPC error
 *
 * Returns:
 * - The original tRPC error, a contract-aware tRPC error retaining the original
 *   cause, or the error unchanged when it is not an intervention contract failure
 */
export const mapAgentInterventionTRPCError = (error: unknown): unknown => {
  if (error instanceof TRPCError) return error;
  if (!(error instanceof Error)) return error;

  const mapped = INTERVENTION_ERROR_CODES[error.message];
  if (!mapped) return error;

  return new TRPCError({ cause: error, code: mapped.code, message: mapped.message });
};
