import {
  DEFAULT_AVATAR,
  DEFAULT_CHAT_GROUP_CHAT_CONFIG,
  DEFAULT_CHAT_GROUP_META_CONFIG,
} from '@lobechat/const';
import { type AgentGroupDetail, type AgentGroupMember } from '@lobechat/types';

import { type ChatGroupState } from '../initialState';
import { type ChatGroupStore } from '../store';
import { agentGroupByIdSelectors } from './byId';

const activeGroupId = (s: ChatGroupState): string | undefined => s.activeGroupId;

const currentGroup = (s: ChatGroupStore): AgentGroupDetail | undefined => {
  const groupId = activeGroupId(s);
  return groupId ? agentGroupByIdSelectors.groupById(groupId)(s) : undefined;
};

const currentGroupConfig = (s: ChatGroupStore) => {
  const groupId = activeGroupId(s);
  return groupId ? agentGroupByIdSelectors.groupConfig(groupId)(s) : DEFAULT_CHAT_GROUP_CHAT_CONFIG;
};

const currentGroupOpeningMessage = (s: ChatGroupStore): string | undefined => {
  const config = currentGroupConfig(s);
  return config?.openingMessage;
};

const currentGroupOpeningQuestions = (s: ChatGroupStore): string[] => {
  const config = currentGroupConfig(s);
  return config?.openingQuestions || [];
};

const currentGroupMeta = (s: ChatGroupStore) => {
  const groupId = activeGroupId(s);
  return groupId ? agentGroupByIdSelectors.groupMeta(groupId)(s) : DEFAULT_CHAT_GROUP_META_CONFIG;
};

const currentGroupAgents = (s: ChatGroupStore): AgentGroupMember[] => {
  const groupId = activeGroupId(s);
  return groupId ? agentGroupByIdSelectors.groupAgents(groupId)(s) : [];
};

const currentGroupMembers = (s: ChatGroupStore): AgentGroupMember[] => {
  const groupId = activeGroupId(s);
  return groupId ? agentGroupByIdSelectors.groupMembers(groupId)(s) : [];
};

const currentGroupMemberAvatars = (s: ChatGroupStore) => {
  const members = currentGroupMembers(s);
  return members.map((agent) => ({
    avatar: agent.avatar || DEFAULT_AVATAR,
    background: agent.backgroundColor || undefined,
  }));
};

const getAllGroups = (s: ChatGroupState): AgentGroupDetail[] => Object.values(s.groupMap);

/**
 * Check if the current active group is loading
 * Uses groupMap pattern instead of manual loading flag
 */
const isGroupsInit = (s: ChatGroupState): boolean =>
  !s.activeGroupId || !s.groupMap[s.activeGroupId];

const isGroupsInitialized = (s: ChatGroupState): boolean => s.groupsInit;

export const currentSelectors = {
  activeGroupId,
  currentGroup,
  currentGroupAgents,
  currentGroupConfig,
  currentGroupMemberAvatars,
  currentGroupMembers,
  currentGroupMeta,
  currentGroupOpeningMessage,
  currentGroupOpeningQuestions,
  getAllGroups,
  isGroupsInit,
  isGroupsInitialized,
};
