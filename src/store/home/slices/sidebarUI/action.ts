import { t } from 'i18next';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { message } from '@/components/AntdStaticMethods';
import { agentService } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { homeService } from '@/services/home';
import { sessionService } from '@/services/session';
import { getAgentStoreState } from '@/store/agent';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { type SessionGroupItemBase } from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('sidebarUI');

type Setter = StoreSetter<HomeStore>;
export const createSidebarUISlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new SidebarUIActionImpl(set, get, _api);

export class SidebarUIActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  duplicateAgent = async (agentId: string, newTitle?: string): Promise<void> => {
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

    await this.#get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new agent
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.agentId);
  };

  duplicateAgentGroup = async (groupId: string, newTitle?: string): Promise<void> => {
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

    await this.#get().refreshAgentList();
    message.destroy(messageLoadingKey);
    message.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new group (using supervisor agent id)
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.supervisorAgentId);
  };

  pinAgent = async (agentId: string, pinned: boolean): Promise<void> => {
    await agentService.updateAgentPinned(agentId, pinned);
    await this.#get().refreshAgentList();
  };

  pinAgentGroup = async (groupId: string, pinned: boolean): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { pinned });
    await this.#get().refreshAgentList();
  };

  removeAgent = async (agentId: string): Promise<void> => {
    await agentService.removeAgent(agentId);
    await this.#get().refreshAgentList();
    // deleting an agent cascade-deletes its topics + messages on the server; drop
    // their message cache too so it doesn't orphan in IndexedDB (never expires)
    void evictMessageCache((ctx) => ctx.agentId === agentId);
  };

  removeAgentGroup = async (groupId: string): Promise<void> => {
    // Delete the group
    await chatGroupService.deleteGroup(groupId);
    await this.#get().refreshAgentList();
    // same cascade for a group's conversations — drop its cached message lists
    void evictMessageCache((ctx) => ctx.groupId === groupId);
  };

  renameAgentGroup = async (
    groupId: string,
    title: string,
    avatar?: string | null,
    backgroundColor?: string,
  ): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { avatar, backgroundColor, title });
    await this.#get().refreshAgentList();
  };

  updateAgentGroup = async (agentId: string, groupId: string | null): Promise<void> => {
    const normalized = groupId === 'default' ? null : groupId;
    const workspaceId = getActiveWorkspaceId();
    if (workspaceId) {
      // Folders are per-member in workspace mode: record the assignment in the
      // caller's workspace_user_settings instead of the shared
      // `agents.sessionGroupId` column, so one member's move never regroups
      // another member's sidebar.
      const { getUserStoreState } = await import('@/store/user');
      await getUserStoreState().updateWorkspaceUserPreference({
        sidebarGroupAssignments: { [agentId]: normalized },
      });
    } else {
      await homeService.updateAgentSessionGroupId(agentId, normalized);
    }
    await this.#get().refreshAgentList();
  };

  addGroup = async (name: string, visibility?: 'private' | 'public'): Promise<string> => {
    const id = await sessionService.createSessionGroup(name, undefined, visibility);
    await this.#get().refreshAgentList();
    return id;
  };

  removeGroup = async (groupId: string): Promise<void> => {
    await sessionService.removeSessionGroup(groupId);
    await this.#get().refreshAgentList();
  };

  updateGroupName = async (groupId: string, name: string): Promise<void> => {
    await sessionService.updateSessionGroup(groupId, { name });
    await this.#get().refreshAgentList();
  };

  updateGroupSort = async (items: SessionGroupItemBase[]): Promise<void> => {
    const sortMap = items.map((item, index) => ({ id: item.id, sort: index }));

    message.loading({
      content: t('sessionGroup.sorting', { ns: 'chat' }),
      duration: 0,
      key: 'updateGroupSort',
    });

    await sessionService.updateSessionGroupOrder(sortMap);
    message.destroy('updateGroupSort');
    message.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

    await this.#get().refreshAgentList();
  };

  setAgentUpdatingId = (id: string | null): void => {
    this.#set({ agentUpdatingId: id }, false, n('setAgentUpdatingId'));
  };

  setGroupUpdatingId = (id: string | null): void => {
    this.#set({ groupUpdatingId: id }, false, n('setGroupUpdatingId'));
  };
}

export type SidebarUIAction = Pick<SidebarUIActionImpl, keyof SidebarUIActionImpl>;
