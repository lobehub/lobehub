import type { AgentGroupTransferToMemberMeta } from './useAgentGroupTransferToMemberMenuItem';

/**
 * Opens the "transfer to member" flow for an agent group — hand its ownership
 * to another workspace member (recipient must accept). Returns null when the
 * viewer cannot start it. Open-source default: unavailable.
 */
export const useAgentGroupTransferToMemberAction = (
  _groupId?: string,
  _groupMeta?: AgentGroupTransferToMemberMeta,
): (() => void) | null => null;
