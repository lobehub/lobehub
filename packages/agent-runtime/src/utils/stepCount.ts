import type { AgentState } from '../types';

/**
 * Number of runtime iterations executed by this operation.
 *
 * This is the internal scheduling/idempotency counter (QStash `stepIndex`,
 * stale-delivery guards, inline resume) — never the user-facing LLM-call
 * count in {@link AgentState.stepCount}. States persisted before the split
 * stored the execution counter in `stepCount`; the fallback keeps in-flight
 * operations recoverable across the rollout.
 */
export const getExecutionStepCount = (
  state?: Pick<AgentState, 'executionStepCount' | 'stepCount'> | null,
): number => {
  if (!state) return 0;
  if (typeof state.executionStepCount === 'number') return state.executionStepCount;
  return typeof state.stepCount === 'number' ? state.stepCount : 0;
};
