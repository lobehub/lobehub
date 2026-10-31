import type { AgentState } from '../types';

/**
 * User-facing LLM-call count for an operation.
 *
 * Prefers the field maintained by the runtime and falls back to the usage
 * counter for states written before the field existed (or by a pre-slot
 * worker during a rolling deploy).
 */
export const getLlmCallCount = (
  state?: { llmCalls?: number; usage?: AgentState['usage'] } | null,
): number => {
  if (!state) return 0;
  // `usage` stays authoritative across a rolling deploy: a pre-slot worker
  // keeps accumulating it but never updates the new `llmCalls` field. Take the
  // larger value so a stale field can never under-report real calls.
  return Math.max(state.llmCalls ?? 0, state.usage?.llm?.apiCalls ?? 0);
};

/**
 * Attempts made by a failed LLM call are carried on the thrown error so the
 * runtime can still record them in the usage counter (a terminal failure has
 * no finalized output to accumulate from).
 */
const LLM_ATTEMPT_COUNT_KEY = 'llmAttempts';

export const getLlmAttemptCount = (error: unknown): number => {
  if (!error || typeof error !== 'object') return 0;
  const value = (error as Record<string, unknown>)[LLM_ATTEMPT_COUNT_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const withLlmAttemptCount = <T>(error: T, attempts: number): T => {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, LLM_ATTEMPT_COUNT_KEY, {
      configurable: true,
      enumerable: false,
      value: attempts,
      writable: true,
    });
    return error;
  }

  return Object.assign(new Error(String(error)), {
    [LLM_ATTEMPT_COUNT_KEY]: attempts,
    cause: error,
  }) as T;
};
