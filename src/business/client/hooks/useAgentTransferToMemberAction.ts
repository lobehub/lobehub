import type { MetaData } from '@lobechat/types';

import type { AgentTransferScope } from './useAgentTransferMenuItem';

/**
 * Opens the "transfer to member" flow for an agent — hand its ownership to
 * another workspace member (recipient must accept). Returns null when the
 * viewer cannot start it. Open-source default: unavailable.
 */
export const useAgentTransferToMemberAction = (
  _agentId?: string,
  _agentMeta?: MetaData,
  _scope?: AgentTransferScope,
): (() => void) | null => null;
