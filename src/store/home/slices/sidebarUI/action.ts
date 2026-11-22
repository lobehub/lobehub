import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { cacheScope } from '@/libs/replica';
import { agentService, type RemoveAgentOptions } from '@/services/agent';
import { chatGroupService } from '@/services/chatGroup';
import { homeService } from '@/services/home';
import { sessionService } from '@/services/session';
import { getAgentStoreState } from '@/store/agent';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { type SessionGroupItemBase } from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('sidebarUI');

/** Upper bound for one member's personal pin list (mirrors the server cap). */
export const MAX_SIDEBAR_PINNED_ITEMS = 200;

export interface PersonalPinTarget {
  id: string;
  /** Current value of the row's own `pinned` column. */
  pinned?: boolean | null;
  type: 'agent' | 'group';
  visibility?: 'private' | 'public' | null;
}

type Setter = StoreSetter<HomeStore>;
export const createSidebarUISlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new SidebarUIActionImpl(set, get, _api);

export class SidebarUIActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;
  #myPinnedQueue: Promise<unknown> = Promise.resolve();

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

  // Writes the `agents.pinned` / `chat_groups.pinned` column. In personal
  // mode that is the user's own pin. In a workspace it is the TEAM pin on a
  // public row (owner/admin only, enforced server-side) and the creator's own
  // pin on a private row (only they can see it). Members pin public rows for
  // themselves through `pinItemForMe` instead.
  pinAgent = async (agentId: string, pinned: boolean): Promise<void> => {
    await agentService.updateAgentPinned(agentId, pinned);
    await this.#get().refreshAgentList();
  };

  pinAgentGroup = async (groupId: string, pinned: boolean): Promise<void> => {
    await chatGroupService.updateGroup(groupId, { pinned });
    await this.#get().refreshAgentList();
  };

  /**
   * Pin / unpin an Agent or chat group for the current member only, in the
   * merged workspace Agents section. The member's pin order lives in their
   * `sidebarPinnedItemIds` preference (newest first); the shared column on a
   * public row is the team pin and is left alone. A private row additionally
   * keeps its own column in sync — only its creator can see it, earlier
   * clients read it as the pin, and a rollback keeps showing it. Unpinning
   * clears both places.
   */
  pinItemForMe = async (item: PersonalPinTarget, pinned: boolean): Promise<void> => {
    const userStore = getUserStoreState();
    const current = userStore.workspaceUserPreference.sidebarPinnedItemIds ?? [];
    const isPrivate = item.visibility === 'private';
    const writeColumn = (value: boolean) =>
      item.type === 'group' ? this.pinAgentGroup(item.id, value) : this.pinAgent(item.id, value);

    const nextIds = pinned
      ? [item.id, ...current.filter((id) => id !== item.id)].slice(0, MAX_SIDEBAR_PINNED_ITEMS)
      : current.filter((id) => id !== item.id);
    const listChanged =
      nextIds.length !== current.length || nextIds.some((id, i) => id !== current[i]);

    if (listChanged) {
      await userStore.updateWorkspaceUserPreference({ sidebarPinnedItemIds: nextIds });
    }
    if (isPrivate && !!item.pinned !== pinned) await writeColumn(pinned);
  };

  /**
   * Reorder the member's own pins in the merged workspace Agents section.
   * `ids` is the new order of the rows the sidebar shows; ids in the stored
   * list that are not shown right now (hidden or dangling) keep their place
   * after them, so a reorder never unpins anything.
   */
  reorderMyPinned = async (ids: string[]): Promise<void> => {
    // The server merges each preference write into what it reads, so two quick
    // drags sent at once could land out of order and the older one would win.
    // Each reorder waits for the previous one and builds on its result. One
    // still queued when the cache scope changes (another account or workspace)
    // is dropped, since the write would land in the new session's preference.
    const scope = cacheScope.get();
    const operation = this.#myPinnedQueue
      .catch(() => undefined)
      .then(async () => {
        if (cacheScope.get() !== scope) return;
        const userStore = getUserStoreState();
        const current = userStore.workspaceUserPreference.sidebarPinnedItemIds ?? [];
        const shown = new Set(ids);
        const nextIds = [...ids, ...current.filter((id) => !shown.has(id))].slice(
          0,
          MAX_SIDEBAR_PINNED_ITEMS,
        );
        if (nextIds.length === current.length && nextIds.every((id, i) => id === current[i]))
          return;

        await userStore.updateWorkspaceUserPreference({ sidebarPinnedItemIds: nextIds });
      });
    this.#myPinnedQueue = operation;
    await operation;
  };

  removeAgent = async (agentId: string, options?: RemoveAgentOptions): Promise<void> => {
    await agentService.removeAgent(agentId, options);
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
