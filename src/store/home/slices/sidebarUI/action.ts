import type { WorkspaceUserPreference } from '@lobechat/types';
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
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';
import { type SessionGroupItemBase } from '@/types/session';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('sidebarUI');

/**
 * Upper bound for one member's pin list (mirrors the server cap). It may hold
 * every team pin, so this matches the team order cap (`MAX_PINNED_ORDER_ITEMS`).
 */
export const MAX_SIDEBAR_PINNED_ITEMS = 2000;

export interface PersonalPinTarget {
  id: string;
  /** Current value of the row's own `pinned` column. */
  pinned?: boolean | null;
  type: 'agent' | 'group';
  visibility?: 'private' | 'public' | null;
}

const isSameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The caller's user store once the server has set their sidebar up. Pin
 * writes replace the whole list, so one built from a cached preference the
 * server has not answered yet could drop what the server is about to add —
 * or, built from the sidebar's guess of the outcome
 * (`workspaceUserSettingsSelectors.sidebarSetupPreview`), persist the wrong
 * one. Such a write waits for that answer instead; the server sets the
 * sidebar up in it.
 */
const getSettledUserStore = async () => {
  const userStore = getUserStoreState();
  if (workspaceUserSettingsSelectors.sidebarSetupPreview(userStore) === null) return userStore;

  await userStore.refreshWorkspaceUserPreference();
  return getUserStoreState();
};

type Setter = StoreSetter<HomeStore>;
export const createSidebarUISlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new SidebarUIActionImpl(set, get, _api);

export class SidebarUIActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;
  #myPinnedQueue: Promise<unknown> = Promise.resolve();

  /** The workspace's legacy team pins (public rows with the shared column), in team order. */
  #teamPinnedIds = (): string[] => this.#get().pinnedAgents.map((item) => item.id);

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
   * `sidebarPinnedItemIds` preference (a new pin goes first); the shared
   * column on a public row is a legacy team pin and is left alone.
   *
   * - Unpinning keeps the row in the sidebar: a public row with no explicit
   *   choice yet (for example a team pin made by a teammate) is added to
   *   the member's list (`sidebarAgentVisibilityOverrides`), so it moves down
   *   instead of vanishing. Removing it stays a separate action.
   * - A private row additionally keeps its own column in sync — only its
   *   creator can see it, earlier clients read it as the pin, and a rollback
   *   keeps showing it. Unpinning clears both places.
   */
  pinItemForMe = async (item: PersonalPinTarget, pinned: boolean): Promise<void> => {
    const userStore = await getSettledUserStore();
    const preference = userStore.workspaceUserPreference;
    const current = preference.sidebarPinnedItemIds ?? [];
    const isPrivate = item.visibility === 'private';
    const writeColumn = (value: boolean) =>
      item.type === 'group' ? this.pinAgentGroup(item.id, value) : this.pinAgent(item.id, value);

    const nextIds = pinned
      ? [item.id, ...current.filter((id) => id !== item.id)].slice(0, MAX_SIDEBAR_PINNED_ITEMS)
      : current.filter((id) => id !== item.id);

    const patch: Partial<WorkspaceUserPreference> = {};
    if (!isSameIds(nextIds, current)) patch.sidebarPinnedItemIds = nextIds;
    if (
      !pinned &&
      !isPrivate &&
      preference.sidebarAgentVisibilityOverrides?.[item.id] === undefined
    )
      patch.sidebarAgentVisibilityOverrides = { [item.id]: true };

    if (Object.keys(patch).length > 0) await userStore.updateWorkspaceUserPreference(patch);
    if (isPrivate && !!item.pinned !== pinned) await writeColumn(pinned);
  };

  /**
   * Reorder the member's pinned list in the merged workspace Agents section.
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
        const userStore = await getSettledUserStore();
        if (cacheScope.get() !== scope) return;
        const current = userStore.workspaceUserPreference.sidebarPinnedItemIds ?? [];
        // A team pin is pinned only through the member's own list; one the
        // sidebar merely previewed as pinned is not pinned by a drag.
        const teamPinned = new Set(this.#teamPinnedIds());
        const kept = ids.filter((id) => !teamPinned.has(id) || current.includes(id));
        const shown = new Set(kept);
        const nextIds = [...kept, ...current.filter((id) => !shown.has(id))].slice(
          0,
          MAX_SIDEBAR_PINNED_ITEMS,
        );
        if (isSameIds(nextIds, current)) return;

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
