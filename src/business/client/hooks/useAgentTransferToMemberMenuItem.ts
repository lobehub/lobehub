import type { MetaData } from '@lobechat/types';
import { type ItemType } from 'antd/es/menu/interface';

import type { AgentTransferScope } from './useAgentTransferMenuItem';

/**
 * "Transfer to member" menu entry — hand an agent's ownership to another
 * workspace member (recipient must accept). Open-source default: absent.
 */
export const useAgentTransferToMemberMenuItem = (
  _agentId?: string,
  _agentMeta?: MetaData,
  _scope?: AgentTransferScope,
): ItemType | null => null;
