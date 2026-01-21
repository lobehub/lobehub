import type { NewChatGroup } from '@lobechat/types';
import urlJoin from 'url-join';
import { type StateCreator } from 'zustand/vanilla';

import { chatGroupService } from '@/services/chatGroup';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { getHomeStoreState } from '@/store/home';

export interface ChatGroupLifecycleAction {
  createGroup: (
    group: Omit<NewChatGroup, 'userId'>,
    agentIds?: string[],
    silent?: boolean,
  ) => Promise<string>;
  /**
   * Switch to a new topic in the group
   * Clears activeTopicId and navigates to group root
   */
  switchToNewTopic: () => void;
  /**
   * Switch to a topic in the group with proper route handling
   * @param topicId - Topic ID to switch to, or undefined/null for new topic
   */
  switchTopic: (topicId?: string | null) => void;
}

export const chatGroupLifecycleSlice: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupLifecycleAction
> = (_, get) => ({
  createGroup: async (newGroup, agentIds, silent = false) => {
    const { switchToGroup, refreshAgentList } = getHomeStoreState();

    const { group } = await chatGroupService.createGroup(newGroup);

    if (agentIds && agentIds.length > 0) {
      await chatGroupService.addAgentsToGroup(group.id, agentIds);

      // Wait a brief moment to ensure database transactions are committed
      // This prevents race condition where loadGroups() executes before member addition is fully persisted
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    get().internal_dispatchChatGroup({ payload: group, type: 'addGroup' });

    // Fetch full group detail to get supervisorAgentId and agents for tools injection
    await get().internal_fetchGroupDetail(group.id);

    refreshAgentList();

    if (!silent) {
      switchToGroup(group.id);
    }

    return group.id;
  },

  switchToNewTopic: () => {
    get().switchTopic(undefined);
  },

  switchTopic: (topicId) => {
    const { activeGroupId, router } = get();
    if (!activeGroupId || !router) return;

    // Update chat store's activeTopicId
    useChatStore.getState().switchTopic(topicId ?? undefined);

    // Navigate with replace to avoid stale query params
    router.push(urlJoin('/group', activeGroupId), {
      query: { topic: topicId ?? null },
      replace: true,
    });
  },
});
