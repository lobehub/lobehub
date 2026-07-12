import type { AgentState } from '../types';

/**
 * Operation-scoped metadata every executor needs (ids for logging / event
 * scoping). Distinct from the transports — this is per-operation context, not
 * an injectable capability. The server builds it once per operation from the
 * request; `stepIndex` advances per step.
 */
export interface RuntimeOperationContext {
  allowEarlyFinalAnswerVisibleOutputEnd?: boolean;
  operationId: string;
  stepIndex: number;
  topicId?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * Operation-lifecycle bookkeeping port. Server adapter wraps the topic /
 * operation-state models; the client adapter can be a no-op.
 *
 * Starts minimal — only `clearRunningMark` (used by `finish` to drop the
 * topic's `runningOperation` so a reconnect doesn't re-trigger). `loadState`
 * (interruption guard) joins here when call_tool / call_llm migrate.
 */
export interface OperationStore {
  clearRunningMark: () => Promise<void>;
  loadState?: (operationId: string) => Promise<AgentState | null>;
}
