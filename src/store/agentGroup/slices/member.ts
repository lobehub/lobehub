import type { LobeAgentConfig } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';
import { type StateCreator } from 'zustand/vanilla';

import { chatGroupService } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';

export interface ChatGroupMemberAction {
  addAgentsToGroup: (groupId: string, agentIds: string[]) => Promise<void>;
  removeAgentFromGroup: (groupId: string, agentId: string) => Promise<void>;
  reorderGroupMembers: (groupId: string, orderedAgentIds: string[]) => Promise<void>;
  /**
   * Update member agent config in group
   * Persists to database via agentStore and refreshes group detail to sync UI
   */
  updateMemberAgentConfig: (
    groupId: string,
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
  ) => Promise<void>;
}

export const chatGroupMemberSlice: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupMemberAction
> = (_, get) => ({
  addAgentsToGroup: async (groupId, agentIds) => {
    await chatGroupService.addAgentsToGroup(groupId, agentIds);
    await get().refreshGroupDetail(groupId);
  },

  removeAgentFromGroup: async (groupId, agentId) => {
    await chatGroupService.removeAgentsFromGroup(groupId, [agentId]);
    await get().refreshGroupDetail(groupId);
  },

  reorderGroupMembers: async (groupId, orderedAgentIds) => {
    await Promise.all(
      orderedAgentIds.map((agentId, index) =>
        chatGroupService.updateAgentInGroup(groupId, agentId, { order: index }),
      ),
    );

    await get().refreshGroupDetail(groupId);
  },

  updateMemberAgentConfig: async (groupId, agentId, config) => {
    // 1. Persist to database via agentStore
    const agentStore = getAgentStoreState();
    await agentStore.updateAgentConfigById(agentId, config);

    // 2. Refresh group detail to sync the updated agent data to groupMap
    await get().refreshGroupDetail(groupId);
  },
});
