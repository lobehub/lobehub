import type { AgentStreamEvent } from './types';

/**
 * `ClientLlmExecutorUnavailable` reasons the server parks a run on in
 * `waiting_for_client` instead of failing it. Mirrors
 * `CLIENT_LLM_WAITABLE_REASONS` in `@lobechat/types` (this package has no deps).
 */
const CLIENT_LLM_WAITABLE_REASONS = new Set(['claim_timeout', 'no_executor', 'not_delivered']);

/**
 * Whether an agent event ends its operation's stream session. An `error` from
 * a relayed LLM call no client took does not: the run waits for a client and
 * streams on once one resumes it (or ends with `agent_runtime_end`), and the
 * error is replayed to every subscriber that joins during the wait.
 */
export const isSessionTerminalEvent = (event: AgentStreamEvent): boolean => {
  if (event.type === 'agent_runtime_end') return true;
  if (event.type !== 'error') return false;

  const data = event.data as { body?: { reason?: unknown }; error?: unknown; errorType?: unknown };
  const errorType = data?.errorType ?? data?.error;
  const reason = data?.body?.reason;
  return !(
    errorType === 'ClientLlmExecutorUnavailable' &&
    typeof reason === 'string' &&
    CLIENT_LLM_WAITABLE_REASONS.has(reason)
  );
};
