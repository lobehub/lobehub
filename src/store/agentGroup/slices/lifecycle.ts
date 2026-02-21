import { type NewChatGroup } from '@lobechat/types';
import urlJoin from 'url-join';

import { chatGroupService } from '@/services/chatGroup';
import { useChatStore } from '@/store/chat';
import { getHomeStoreState } from '@/store/home';

import { type ChatGroupStore } from '../store';

type ChatGroupStoreWithSwitchTopic = ChatGroupStore & {
  switchTopic: (topicId?: string | null) => void;
};

export class ChatGroupLifecycleAction {
  readonly #get: () => ChatGroupStoreWithSwitchTopic;

  constructor(_set: unknown, get: () => ChatGroupStoreWithSwitchTopic, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _set;
    void _api;

    this.#get = get;
  }

  createGroup = async (
    newGroup: Omit<NewChatGroup, 'userId'>,
    agentIds?: string[],
    silent: any = false,
  ) => {
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

    this.#get().internal_dispatchChatGroup({ payload: group, type: 'addGroup' });

    // Fetch full group detail to get supervisorAgentId and agents for tools injection
    await this.#get().internal_fetchGroupDetail(group.id);

    refreshAgentList();

    if (!silent) {
      switchToGroup(group.id);
    }

    return group.id;
  };

  /**
   * Switch to a new topic in the group
   * Clears activeTopicId and navigates to group root
   */
  switchToNewTopic = () => {
    this.#get().switchTopic(undefined);
  };

  /**
   * Switch to a topic in the group with proper route handling
   * @param topicId - Topic ID to switch to, or undefined/null for new topic
   */
  switchTopic = (topicId?: string | null) => {
    const { activeGroupId, router } = this.#get();
    if (!activeGroupId || !router) return;

    // Update chat store's activeTopicId
    useChatStore.getState().switchTopic(topicId ?? undefined);

    // Navigate with replace to avoid stale query params
    router.push(urlJoin('/group', activeGroupId), {
      query: { topic: topicId ?? null },
      replace: true,
    });
  };
}
