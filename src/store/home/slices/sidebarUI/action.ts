import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { cacheScope } from '@/libs/replica';
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

  duplicateAgent = async (agentId: string, newTitle?: string): Promise<string | undefined> => {
    const loadingToast = toast.loading(t('duplicateSession.loading', { ns: 'chat' }));

    const result = await agentService.duplicateAgent(agentId, newTitle);

    if (!result) {
      loadingToast.close();
      toast.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await this.#get().refreshAgentList();
    loadingToast.close();
    toast.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new agent
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.agentId);
    return result.agentId;
  };

  duplicateAgentGroup = async (groupId: string, newTitle?: string): Promise<string | undefined> => {
    const loadingToast = toast.loading(t('duplicateSession.loading', { ns: 'chat' }));

    const result = await chatGroupService.duplicateGroup(groupId, newTitle);

    if (!result) {
      loadingToast.close();
      toast.error(t('copyFail', { ns: 'common' }));
      return;
    }

    await this.#get().refreshAgentList();
    loadingToast.close();
    toast.success(t('duplicateSession.success', { ns: 'chat' }));

    // Switch to the new group (using supervisor agent id)
    const agentStore = getAgentStoreState();
    agentStore.setActiveAgentId(result.supervisorAgentId);
    return result.groupId;
  };

  // Pinning is part of the SHARED sidebar arrangement in workspace mode — it
  // writes the same `agents.pinned` / `chat_groups.pinned` columns as personal
  // mode, so every member sees the same pinned section. A member who doesn't
  // want an item in their own sidebar hides it instead (personal layer).
  pinAgent = async (agentId: string, pinned: boolean): Promise<void> => {
    await agentService.updateAgentPinned(agentId, pinned);
    await this.#get().refreshAgentList();
  };

  pinAgentGroup = async (groupId: string, pinned: boolean): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { pinned });
    await this.#get().refreshAgentList();
  };

  removeAgent = async (agentId: string): Promise<void> => {
    const { channelActions } = await import('@/store/channel');
    const scope = cacheScope.get();
    await agentService.removeAgent(agentId);
    if (cacheScope.get() !== scope) return;
    getAgentStoreState().markAgentDeleted(agentId);
    this.#get().removeAgentFromList(agentId);
    await Promise.all([
      this.#get()
        .fetchAgentList()
        .catch((error) => {
          console.error('Failed to refresh sidebar after Agent deletion', error);
        }),
      channelActions.retireAgent(agentId),
    ]);
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

  // Folder membership is shared: moving an item writes the shared
  // `agents.sessionGroupId` column in both scopes, so the workspace sidebar
  // stays one collectively-curated structure.
  updateAgentGroup = async (agentId: string, groupId: string | null): Promise<void> => {
    const normalized = groupId === 'default' ? null : groupId;
    await homeService.updateAgentSessionGroupId(agentId, normalized);
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

    const loadingToast = toast.loading(t('sessionGroup.sorting', { ns: 'chat' }));

    await sessionService.updateSessionGroupOrder(sortMap);
    loadingToast.close();
    toast.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

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
