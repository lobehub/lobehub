import { type AgentGroupDetail } from '@lobechat/types';

import { type ChatGroupState } from '../initialState';

const activeGroupId = (s: ChatGroupState): string | undefined => s.activeGroupId;

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
  getAllGroups,
  isGroupsInit,
  isGroupsInitialized,
};
