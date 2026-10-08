import { AgentRuntimeError } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, CLIENT_LLM_WAITABLE_REASONS } from '@lobechat/types';

/**
 * Errors of a relayed LLM attempt, shaped like every other provider error
 * (`AgentRuntimeError.chat`) so the retry classifier and the error card read
 * them the same way. Retry budgets for the retryable ones live in
 * `resolveLlmRelayRetryBudget`.
 */

export type ClientLlmUnavailableReason =
  /** The run has no client that declared it can execute this provider. */
  | 'no_executor'
  /** An executor was asked, but no batch arrived within `claimMs`. */
  | 'claim_timeout'
  /** The gateway delivered `llm_execute` to no connected client. */
  | 'not_delivered'
  /** The deployment cannot relay (no Redis / gateway). */
  | 'relay_unsupported'
  /** The run waited for a client (`waiting_for_client`) and none came in time. */
  | 'wait_timeout';

/**
 * Reasons a client can still fix by showing up: the run parks in
 * `waiting_for_client` for them instead of failing (U4c). `relay_unsupported`
 * is a deployment gap no client can close.
 */
const CLIENT_WAITABLE_REASONS = new Set<string>(CLIENT_LLM_WAITABLE_REASONS);

export type ClientLlmTimeoutStage = 'first_chunk' | 'total';

export type ClientLlmLostReason =
  /** No batch within `idleMs`. */
  | 'idle'
  /** A batch went missing and was not re-sent within `idleMs`. */
  | 'gap'
  /** The client ended the attempt itself without the server asking. */
  | 'client_aborted';

export const createClientLlmExecutorUnavailableError = (
  provider: string,
  reason: ClientLlmUnavailableReason,
  extra?: Record<string, unknown>,
) =>
  AgentRuntimeError.chat({
    error: { reason, recoverable: true, ...extra },
    errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
    provider,
  });

export const createClientLlmTimeoutError = (provider: string, stage: ClientLlmTimeoutStage) =>
  AgentRuntimeError.chat({
    error: { stage },
    errorType: AgentRuntimeErrorType.ClientLlmTimeout,
    provider,
  });

export const createClientLlmExecutorLostError = (provider: string, reason: ClientLlmLostReason) =>
  AgentRuntimeError.chat({
    error: { reason },
    errorType: AgentRuntimeErrorType.ClientLlmExecutorLost,
    provider,
  });

const getErrorType = (error: unknown) =>
  error && typeof error === 'object' ? (error as { errorType?: unknown }).errorType : undefined;

const getErrorDetail = (error: unknown) =>
  error && typeof error === 'object'
    ? ((error as { error?: Record<string, unknown> }).error ?? {})
    : {};

export const isClientLlmRelayError = (error: unknown) => {
  const errorType = getErrorType(error);
  return (
    errorType === AgentRuntimeErrorType.ClientLlmExecutorUnavailable ||
    errorType === AgentRuntimeErrorType.ClientLlmExecutorLost ||
    errorType === AgentRuntimeErrorType.ClientLlmTimeout
  );
};

/**
 * The reason of an unavailable-executor error a client can still fix, read off
 * either the thrown error or its persisted form (`formatErrorForState` keeps the
 * detail under `body`). `undefined` for anything else.
 */
export const getClientLlmWaitableReason = (
  error: unknown,
): ClientLlmUnavailableReason | undefined => {
  if (!error || typeof error !== 'object') return;
  const { body, errorType, type } = error as {
    body?: { reason?: unknown };
    errorType?: unknown;
    type?: unknown;
  };
  if (
    errorType !== AgentRuntimeErrorType.ClientLlmExecutorUnavailable &&
    type !== AgentRuntimeErrorType.ClientLlmExecutorUnavailable
  )
    return;
  const reason = (getErrorDetail(error).reason ?? body?.reason) as ClientLlmUnavailableReason;
  return CLIENT_WAITABLE_REASONS.has(reason) ? reason : undefined;
};

/**
 * Retries a relay failure may take (U4b): a lost executor is re-dispatched as a
 * fresh attempt (new `callId`) up to twice, a missed first chunk once. A missed
 * total deadline is not retried — the step has no budget left for another
 * attempt — and neither is an unavailable executor: nobody would pick it up.
 * `undefined` for errors that are not relay failures.
 */
export const resolveLlmRelayRetryBudget = (error: unknown): number | undefined => {
  switch (getErrorType(error)) {
    case AgentRuntimeErrorType.ClientLlmExecutorLost: {
      return 2;
    }
    case AgentRuntimeErrorType.ClientLlmTimeout: {
      return getErrorDetail(error).stage === 'first_chunk' ? 1 : 0;
    }
    case AgentRuntimeErrorType.ClientLlmExecutorUnavailable: {
      return 0;
    }
  }
};
