import type { AgentRunLineage } from './state';

/** Run correlation shared only by the three compact notifications. */
export interface CompactHookContext {
  agentId?: string;
  /** Actual persisted run lineage; absent for runs without lineage. */
  lineage?: AgentRunLineage;
  /** Only the explicit lineage parent, never inferred from a thread or progress anchor. */
  parentOperationId?: string;
  threadId?: string;
  topicId?: string;
  workspaceId?: string;
}
