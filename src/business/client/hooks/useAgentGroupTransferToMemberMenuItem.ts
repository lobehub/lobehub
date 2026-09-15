import { type ItemType } from 'antd/es/menu/interface';

export interface AgentGroupTransferToMemberMeta {
  avatar?: string | null;
  backgroundColor?: string | null;
  title?: string | null;
}

/**
 * "Transfer to member" menu entry — hand a group's ownership to another
 * workspace member (recipient must accept). Open-source default: absent.
 */
export const useAgentGroupTransferToMemberMenuItem = (
  _groupId?: string,
  _groupMeta?: AgentGroupTransferToMemberMeta,
): ItemType | null => null;
