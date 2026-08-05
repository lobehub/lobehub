import { DEFAULT_AVATAR } from '@lobechat/const';
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

const groupMemberAvatars =
  (groupId: string) =>
  (s: ChatGroupStore): { avatar: string; background?: string }[] =>
    groupMembers(groupId)(s).map((agent) => ({
      avatar: agent.avatar || DEFAULT_AVATAR,
      background: agent.backgroundColor || undefined,
    }));

const groupOpeningMessage =
  (groupId: string) =>
  (s: ChatGroupStore): string | undefined =>
    groupConfig(groupId)(s)?.openingMessage;

const groupOpeningQuestions =
  (groupId: string) =>
  (s: ChatGroupStore): string[] =>
    groupConfig(groupId)(s)?.openingQuestions || [];

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

/**
 * The group detail fetch settled on nothing — the group doesn't exist or the
 * viewer lost access (e.g. it was switched back to private by its owner).
 */
const isGroupNotFoundById =
  (groupId: string) =>
  (s: ChatGroupState): boolean =>
    !!groupId && !!s.groupNotFoundMap[groupId];

export const agentGroupByIdSelectors = {
  agentByIdFromGroup,
  groupAgentCount,
  groupAgents,
  groupById,
  groupBySupervisorAgentId,
  groupConfig,
  groupMemberAvatars,
  groupMemberCount,
  groupMembers,
  groupMeta,
  groupOpeningMessage,
  groupOpeningQuestions,
  isGroupNotFoundById,
};
