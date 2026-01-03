import type { NewChatGroup } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import { chatGroupService } from '@/services/chatGroup';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { getSessionStoreState } from '@/store/session';

export interface ChatGroupLifecycleAction {
  createGroup: (
    group: Omit<NewChatGroup, 'userId'>,
    agentIds?: string[],
    silent?: boolean,
  ) => Promise<string>;
}

export const chatGroupLifecycleSlice: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupLifecycleAction
> = (_, get) => ({
  /**
   * @param silent - if true, do not switch to the new group session
   */
  createGroup: async (newGroup, agentIds, silent = false) => {
    const { switchSession } = getSessionStoreState();

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

    await get().loadGroups();
    await getSessionStoreState().refreshSessions();

    if (!silent) {
      switchSession(group.id);
    }

    return group.id;
  },
});
