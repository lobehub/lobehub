import { type AgentGroupDetail, type AgentGroupMember, type AgentItem } from '@lobechat/types';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG, DEFAULT_CHAT_GROUP_META_CONFIG } from '@/const/settings';
import { merge } from '@/utils/merge';

import { type ChatGroupState } from '../initialState';
import { type ChatGroupStore } from '../store';

const groupById =
  (id: string) =>
  (s: ChatGroupState): AgentGroupDetail | undefined =>
    s.groupMap[id];

const groupConfig = (groupId: string) => (s: ChatGroupStore) => {
  const group = groupById(groupId)(s);
  return merge(DEFAULT_CHAT_GROUP_CHAT_CONFIG, group?.config || {});
};

const groupMeta = (groupId: string) => (s: ChatGroupStore) => {
  const group = groupById(groupId)(s);
  return merge(DEFAULT_CHAT_GROUP_META_CONFIG, {
    avatar: group?.avatar || undefined,
    backgroundColor: group?.backgroundColor || undefined,
    description: group?.description || '',
    marketIdentifier: group?.marketIdentifier || undefined,
    title: group?.title || '',
  });
};

const groupAgents =
  (groupId: string) =>
  (s: ChatGroupStore): AgentGroupMember[] => {
    const group = groupById(groupId)(s);
    return group?.agents || [];
  };

/**
 * Get participant members in a group (excluding supervisor)
 * Used for UI display where supervisor should not be shown in the member list
 */
const groupMembers =
  (groupId: string) =>
  (s: ChatGroupStore): AgentGroupMember[] => {
    const group = groupById(groupId)(s);
    const agents = group?.agents || [];
    return agents.filter((agent) => !agent.isSupervisor);
  };

const groupAgentCount =
  (groupId: string) =>
  (s: ChatGroupStore): number =>
    groupAgents(groupId)(s).length;

const groupMemberCount =
  (groupId: string) =>
  (s: ChatGroupStore): number =>
    groupMembers(groupId)(s).length;

const agentByIdFromGroup =
  (groupId: string, agentId: string) =>
  (s: ChatGroupStore): AgentItem | undefined => {
    const agents = groupAgents(groupId)(s);
    return agents.find((agent) => agent.id === agentId);
  };

/**
 * Find a group by its supervisor agent ID
 * Iterates through all groups to find one where supervisorAgentId matches
 */
const groupBySupervisorAgentId =
  (supervisorAgentId: string) =>
  (s: ChatGroupStore): AgentGroupDetail | undefined => {
    return Object.values(s.groupMap).find((group) => group.supervisorAgentId === supervisorAgentId);
  };

export const agentGroupByIdSelectors = {
  agentByIdFromGroup,
  groupAgentCount,
  groupAgents,
  groupById,
  groupBySupervisorAgentId,
  groupConfig,
  groupMemberCount,
  groupMembers,
  groupMeta,
};
