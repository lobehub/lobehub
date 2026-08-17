import type { AgentState } from '../types';

/**
 * Operation-scoped metadata every executor needs (ids for logging / event
 * scoping). Distinct from the transports — this is per-operation context, not
 * an injectable capability. The server builds it once per operation from the
 * request; `stepIndex` advances per step.
 */
export interface RuntimeOperationContext {
  /** Effective message owner for this operation (group member when applicable). */
  agentId?: string;
  allowEarlyFinalAnswerVisibleOutputEnd?: boolean;
  groupId?: string;
  operationId: string;
  stepIndex: number;
  threadId?: string;
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
  /**
   * Drop the topic's running mark — but ONLY when this operation owns it.
   * Several operations share one topic (a `callAgent` / `callSubAgent` / group
   * member run executes in an isolation thread on its parent's topic), and the
   * mark is the *main* run's reconnect anchor. An unconditional clear here lets
   * a short-lived child strand its still-running parent: no mark means no
   * gateway reconnect, so the conversation goes silent for the rest of the run.
   * Implementations must compare before clearing.
   */
  clearRunningMark: () => Promise<void>;
  loadState?: (operationId: string) => Promise<AgentState | null>;
}
