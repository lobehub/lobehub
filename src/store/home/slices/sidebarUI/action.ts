/* eslint-disable sort-keys-fix/sort-keys-fix,typescript-sort-keys/interface */
import { t } from 'i18next';
import { type StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { homeService } from '@/services/home';
import { sessionService } from '@/services/session';
import { getAgentStoreState } from '@/store/agent';
import type { HomeStore } from '@/store/home/store';
import type { SessionGroupItemBase } from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('sidebarUI');

export interface SidebarUIAction {
  // ========== Agent Operations ==========
  /**
   * Duplicate an agent using agentService
   */
  duplicateAgent: (agentId: string, newTitle?: string) => Promise<void>;
  /**
   * Duplicate a chat group (multi-agent group)
   */
  duplicateAgentGroup: (groupId: string, newTitle?: string) => Promise<void>;
  /**
   * Pin or unpin an agent
   */
  pinAgent: (agentId: string, pinned: boolean) => Promise<void>;
  /**
   * Pin or unpin an agent group
   */
  pinAgentGroup: (groupId: string, pinned: boolean) => Promise<void>;
  /**
   * Remove an agent
   */
  removeAgent: (agentId: string) => Promise<void>;
  /**
   * Remove an agent group (group chat)
   */
  removeAgentGroup: (groupId: string) => Promise<void>;
  /**
   * Rename an agent group (group chat)
   */
  renameAgentGroup: (groupId: string, title: string) => Promise<void>;
  /**
   * Update agent's group
   */
  updateAgentGroup: (agentId: string, groupId: string | null) => Promise<void>;

  // ========== Group Operations ==========
  /**
   * Add a new group
   */
  addGroup: (name: string) => Promise<string>;
  /**
   * Remove a group
   */
  removeGroup: (groupId: string) => Promise<void>;
  /**
   * Update group name
   */
  updateGroupName: (groupId: string, name: string) => Promise<void>;
  /**
   * Update group sort order
   */
  updateGroupSort: (items: SessionGroupItemBase[]) => Promise<void>;

  // ========== UI State Actions ==========
  /**
   * Set agent renaming id
   */
  setAgentRenamingId: (id: string | null) => void;
  /**
   * Set agent updating id
   */
  setAgentUpdatingId: (id: string | null) => void;
  /**
   * Set group renaming id
   */
  setGroupRenamingId: (id: string | null) => void;
  /**
   * Set group updating id
   */
  setGroupUpdatingId: (id: string | null) => void;
}

export const createSidebarUISlice: StateCreator<
  HomeStore,
  [['zustand/devtools', never]],
  [],
  SidebarUIAction
> = (set, get) => ({
  // ========== Agent Operations ==========
  duplicateAgent: async (agentId, newTitle?: string) => {
    const messageLoadingKey = 'duplicateAgent.loading';

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    const result = await agentService.duplicateAgent(agentId, newTitle);

    if (!result) {
      message.destroy(messageLoadingKey);
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new agent
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.agentId);
  },

  duplicateAgentGroup: async (groupId, newTitle?: string) => {
    const messageLoadingKey = 'duplicateAgentGroup.loading';

    message.loading({
      content: t('duplicateSession.loading', { ns: 'chat' }),
      duration: 0,
      key: messageLoadingKey,
    });

    const result = await chatGroupService.duplicateGroup(groupId, newTitle);

    if (!result) {
      message.destroy(messageLoadingKey);
      message.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new group (using supervisor agent id)
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.supervisorAgentId);
  },

  pinAgent: async (agentId, pinned) => {
    await agentService.updateAgentPinned(agentId, pinned);
    await get().refreshAgentList();
  },

  pinAgentGroup: async (groupId, pinned) => {
    await chatGroupService.updateGroup(groupId, { pinned });
    await get().refreshAgentList();
  },

  removeAgent: async (agentId) => {
    await agentService.removeAgent(agentId);
    await get().refreshAgentList();
  },

  removeAgentGroup: async (groupId) => {
    // Delete the group
    await chatGroupService.deleteGroup(groupId);
    await get().refreshAgentList();
  },

  renameAgentGroup: async (groupId, title) => {
    await chatGroupService.updateGroup(groupId, { title });
    await get().refreshAgentList();
  },

  updateAgentGroup: async (agentId, groupId) => {
    await homeService.updateAgentSessionGroupId(agentId, groupId === 'default' ? null : groupId);
    await get().refreshAgentList();
  },

  // ========== Group Operations ==========
  addGroup: async (name) => {
    const id = await sessionService.createSessionGroup(name);
    await get().refreshAgentList();
    return id;
  },

  removeGroup: async (groupId) => {
    await sessionService.removeSessionGroup(groupId);
    await get().refreshAgentList();
  },

  updateGroupName: async (groupId, name) => {
    await sessionService.updateSessionGroup(groupId, { name });
    await get().refreshAgentList();
  },

  updateGroupSort: async (items) => {
    const sortMap = items.map((item, index) => ({ id: item.id, sort: index }));

    message.loading({
      content: t('sessionGroup.sorting', { ns: 'chat' }),
      duration: 0,
      key: 'updateGroupSort',
    });

    await sessionService.updateSessionGroupOrder(sortMap);
    message.destroy('updateGroupSort');
    message.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

    await get().refreshAgentList();
  },

  // ========== UI State Actions ==========
  setAgentRenamingId: (id) => {
    set({ agentRenamingId: id }, false, n('setAgentRenamingId'));
  },

  setAgentUpdatingId: (id) => {
    set({ agentUpdatingId: id }, false, n('setAgentUpdatingId'));
  },

  setGroupRenamingId: (id) => {
    set({ groupRenamingId: id }, false, n('setGroupRenamingId'));
  },

  setGroupUpdatingId: (id) => {
    set({ groupUpdatingId: id }, false, n('setGroupUpdatingId'));
  },
});
