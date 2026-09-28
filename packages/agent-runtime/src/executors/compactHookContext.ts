import type { RuntimeOperationContext } from '../transport/operation';
import type { CompactHookContext } from '../types/compactHooks';
import type { AgentRunOrigin } from '../types/state';

/** Mirror the effective compression context without inventing missing run ancestry. */
export const buildCompactHookContext = (
  operation: RuntimeOperationContext,
  origin?: AgentRunOrigin,
): CompactHookContext => ({
  agentId: operation.agentId ?? origin?.agentId,
  ...(origin?.lineage && { lineage: structuredClone(origin.lineage) }),
  ...(origin?.lineage?.parentOperationId && {
    parentOperationId: origin.lineage.parentOperationId,
  }),
  threadId: operation.threadId ?? origin?.threadId,
  topicId: origin?.topicId ?? operation.topicId,
  workspaceId: origin?.workspaceId ?? operation.workspaceId,
});
