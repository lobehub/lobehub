import type { EvalCaseEnvironment } from './agentEval';

// ============================================
// Environment Entity Types
// ============================================

/**
 * A reusable case environment: the Agent setup (persona, tools, memory
 * switch), the Memory fixture, the clock and the mock connectors that many
 * cases share. A case points at one through `environmentId`; one environment
 * can back five, ten or a hundred cases, so none of this is copied per case.
 */
export interface AgentEvalEnvironment {
  config: EvalCaseEnvironment;
  createdAt: Date;
  description?: string | null;
  id: string;
  /** Stable handle for scripts and imports (unique per owner when set). */
  identifier?: string | null;
  metadata?: Record<string, unknown> | null;
  name: string;
  updatedAt: Date;
  userId?: string | null;
  workspaceId?: string | null;
}

/** Environment list row: the entity plus how many cases point at it. */
export interface AgentEvalEnvironmentListItem extends AgentEvalEnvironment {
  testCaseCount?: number;
}
