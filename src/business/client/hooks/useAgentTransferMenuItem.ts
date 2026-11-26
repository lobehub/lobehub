import type { MetaData } from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';

export interface AgentTransferScope {
  userId?: string | null;
  visibility?: 'private' | 'public';
}

export const useAgentTransferMenuItem = (
  _agentId?: string,
  _agentMeta?: MetaData,
): ItemType[] | null => null;
