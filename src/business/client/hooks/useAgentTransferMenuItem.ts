import type { MetaData } from '@lobechat/types';
import { type ItemType } from 'antd/es/menu/interface';

export interface AgentTransferScope {
  userId?: string | null;
  visibility?: 'private' | 'public';
}

export const useAgentTransferMenuItem = (
  _agentId?: string,
  _agentMeta?: MetaData,
  _scope?: AgentTransferScope,
): ItemType[] | null => null;
