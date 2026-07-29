import { type LobeAgentConfig } from '@lobechat/types';
import { type PartialDeep } from 'type-fest';

import { chatGroupService, type GroupMemberConfig } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';

type ChatGroupStoreWithRefresh = ChatGroupStore & {
  refreshGroupDetail: (groupId: string) => Promise<void>;
};

export class ChatGroupMemberAction {
  readonly #get: () => ChatGroupStoreWithRefresh;

  constructor(_set: unknown, get: () => ChatGroupStoreWithRefresh, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _set;
    void _api;

    this.#get = get;
  }

  addAgentsToGroup = async (groupId: string, agentIds: string[]) => {
    await chatGroupService.addAgentsToGroup(groupId, agentIds);
    await this.#get().refreshGroupDetail(groupId);
  };

  /**
   * Create a blank virtual agent that lives only inside the group and add it as a member.
   * Returns the new agent id so the caller can navigate to it.
   */
  createAgentInGroup = async (
    groupId: string,
    config?: GroupMemberConfig,
  ): Promise<string | undefined> => {
    const { agentIds } = await chatGroupService.batchCreateAgentsInGroup(groupId, [config ?? {}]);
    await this.#get().refreshGroupDetail(groupId);
    return agentIds[0];
  };

  removeAgentFromGroup = async (groupId: string, agentId: string) => {
    await chatGroupService.removeAgentsFromGroup(groupId, [agentId]);
    await this.#get().refreshGroupDetail(groupId);
  };

  reorderGroupMembers = async (groupId: string, orderedAgentIds: string[]) => {
    await Promise.all(
      orderedAgentIds.map((agentId, index) =>
        chatGroupService.updateAgentInGroup(groupId, agentId, { order: index }),
      ),
    );

    await this.#get().refreshGroupDetail(groupId);
  };

  /**
   * Update member agent config in group
   * Persists to database via agentStore and refreshes group detail to sync UI
   */
  updateMemberAgentConfig = async (
    groupId: string,
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
  ) => {
    // 1. Persist to database via agentStore
    const agentStore = getAgentStoreState();
    await agentStore.updateAgentConfigById(agentId, config);

    // 2. Refresh group detail to sync the updated agent data to groupMap
    await this.#get().refreshGroupDetail(groupId);
  };
}
