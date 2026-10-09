import { type AgentGroupDetail } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import {
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { chatGroupService } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { type ResetableStore } from '@/store/utils/resetableStore';
import { setNamespace } from '@/utils/storeDebug';

import { initialChatGroupState } from './initialState';
import {
  AGENT_GROUP_LIST_KEY,
  agentGroupDetailEntity,
  agentGroupDetailResource,
  agentGroupListResource,
  agentGroupsEntity,
} from './projection';
import { ChatGroupCurdAction } from './slices/curd';
import { ChatGroupLifecycleAction } from './slices/lifecycle';
import { ChatGroupMemberAction } from './slices/member';

const n = setNamespace('chatGroup');

/** The group list is one entry per scope, so every sync shares these params. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * Convert ChatGroupItem to AgentGroupDetail by adding empty agents array if not present
 */
const toAgentGroupDetail = (group: ChatGroupItem): AgentGroupDetail =>
  ({
    ...group,
    agents: [],
  }) as AgentGroupDetail;

/**
 * The group list keeps its long-standing flat `groups` field as the replica
 * view, so every selector keeps reading what it did. The init flag gates it:
 * before the first hydrate/replace the view must read `undefined`, otherwise
 * the empty default would block hydration from storage.
 */
const groupsLens: ReplicaLens<ChatGroupStore, ChatGroupItem[]> = {
  clear: () => ({ groups: [], groupsInit: false }),
  get: (state) => (state.groupsInit ? state.groups : undefined),
  keys: (state) => (state.groupsInit ? [AGENT_GROUP_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data === undefined ? { groups: [], groupsInit: false } : { groups: data, groupsInit: true },
};

/** `groupMap` is a plain `Record<groupId, detail>`, so the stock record lens fits. */
const groupDetailLens = recordLens<ChatGroupStore, AgentGroupDetail>('groupMap');

type Setter = StoreSetter<ChatGroupStore>;

class ChatGroupInternalAction implements ResetableStore {
  readonly #get: () => ChatGroupStore;
  readonly #set: Setter;
  /** One group's detail behind `groupMap[groupId]` — the roster and config. */
  readonly #groupDetail;
  /** The group list behind `groups` (one entry per scope). */
  readonly #groupList;
  /** One group lives in the list row and in `groupMap`: write to both at once. */
  readonly #groupRows;

  constructor(set: Setter, get: () => ChatGroupStore, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    this.#get = get;
    this.#groupList = createReplicaSlice(agentGroupListResource, {
      actionPrefix: 'agentGroupList',
      entity: agentGroupsEntity,
      fetcher: () => chatGroupService.getGroups(),
      get,
      set,
      stateKey: 'agentGroupListReplica',
      view: groupsLens,
    });
    this.#groupDetail = createReplicaSlice(agentGroupDetailResource, {
      actionPrefix: 'agentGroupDetail',
      entity: agentGroupDetailEntity,
      fetcher: async ({ groupId }) => await chatGroupService.getGroupDetail(groupId),
      get,
      // The endpoint returns the complete, authoritative detail. `null` (gone /
      // no access) is settled by the sync hook, not a value to paint, so it
      // keeps the current entry and lets the hook drop it. An unchanged detail
      // keeps its reference so the group pages do not re-render.
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'agentGroupDetailReplica',
      view: groupDetailLens,
    });
    this.#groupRows = linkReplicaEntity<ChatGroupItem>([this.#groupList, this.#groupDetail]);
  }

  reset: ResetableStore['reset'] = () => {
    this.#set(initialChatGroupState, false, n('reset'));
  };

  /**
   * The cache scope (`${userId}:${workspaceId}`) a request starts under. The
   * full scope is what partitions the persisted replica rows, so it — not just
   * the workspace id — is what an imperative response must be validated
   * against: two users in personal mode share a `null` workspace, and a
   * response started for one must never land in the other's partition.
   */
  #captureScope = (): string => cacheScope.get();

  /** Whether the identity a request started under is still the active one. */
  #isStillInScope = (scope: string): boolean => cacheScope.get() === scope;

  #removeStaleGroup = (groupId: string) => {
    this.#groupRows.remove(groupId);
  };

  // A successful fetch that resolves to nothing means the group doesn't exist
  // or the caller lost access (e.g. switched back to private) — a settled
  // state the UI renders as a 404 card, not an error to retry.
  #markGroupNotFound = (groupId: string) => {
    if (this.#get().groupNotFoundMap[groupId]) return;

    this.#set(
      (state) => ({ groupNotFoundMap: { ...state.groupNotFoundMap, [groupId]: true } }),
      false,
      'markGroupNotFound',
    );
  };

  #clearGroupNotFound = (groupId: string) => {
    if (!this.#get().groupNotFoundMap[groupId]) return;

    this.#set(
      (state) => {
        const next = { ...state.groupNotFoundMap };
        delete next[groupId];
        return { groupNotFoundMap: next };
      },
      false,
      'clearGroupNotFound',
    );
  };

  /**
   * Push a fetched group's roster into the agent store, so builtin agent
   * resolution (e.g. the supervisor slug) and the model switcher find it, and
   * adopt the supervisor as the active agent for correct model resolution.
   */
  #syncGroupAgents = (groupDetail: AgentGroupDetail, { onlyIfNewer = false } = {}) => {
    const agentStore = getAgentStoreState();
    for (const agent of groupDetail.agents) {
      // A background sync must not overwrite a newer local agent, but an
      // explicit refresh (right after a write) always takes the server value.
      const current = agentStore.agentMap[agent.id];
      if (
        onlyIfNewer &&
        current &&
        !(new Date(agent.updatedAt) > new Date(current.updatedAt || 0))
      ) {
        continue;
      }

      // AgentGroupMember extends AgentItem which shares fields with LobeAgentConfig
      agentStore.internal_dispatchAgentMap(agent.id, agent as any);
    }

    if (groupDetail.supervisorAgentId) {
      agentStore.setActiveAgentId(groupDetail.supervisorAgentId);
      useChatStore.setState(
        { activeAgentId: groupDetail.supervisorAgentId },
        false,
        'syncActiveAgentIdFromAgentGroup',
      );
    }
  };

  internal_fetchGroupDetail = async (groupId: string) => {
    const scope = this.#captureScope();
    const groupDetail = await chatGroupService.getGroupDetail(groupId);
    // The request may resolve after a logout / account switch; its response
    // belongs to the scope it started under, not the one active now.
    if (!this.#isStillInScope(scope)) return;

    if (!groupDetail) {
      this.#removeStaleGroup(groupId);
      this.#markGroupNotFound(groupId);
      return;
    }
    this.#clearGroupNotFound(groupId);

    // Confirmed server detail: it paints the group page on the next visit too.
    // The captured scope makes the write itself admit only its own identity.
    this.#groupDetail.replace({ groupId }, groupDetail, scope);
    this.#syncGroupAgents(groupDetail);
  };

  /**
   * Add a freshly created group to every view that holds group rows. The detail
   * entry is only a `seed` (the create response carries no roster): it keeps the
   * new group resolvable until {@link internal_fetchGroupDetail} confirms it.
   */
  internal_addGroup = (group: ChatGroupItem) => {
    this.#groupList.update(AGENT_GROUP_LIST_KEY, (items) => [...(items ?? []), group], {
      persist: false,
    });
    this.#groupDetail.update(group.id, () => toAgentGroupDetail(group), {
      persist: false,
      source: 'seed',
    });
  };

  /** Patch one group row in every view that holds it (list row + detail map). */
  internal_updateGroupRow = (id: string, value: Partial<ChatGroupItem>) => {
    this.#groupRows.update(id, (group) => ({ ...group, ...value }));
  };

  /**
   * Merge a group list payload into `groupMap`. A group that is already loaded
   * keeps its roster (`agents`) and its authoritative `config`; a group that is
   * only known from the list gets an empty roster until its detail fetch lands.
   *
   * The write is a `seed`, not authoritative detail: it is in-memory only, and
   * the detail replica may still hydrate the persisted full detail over it (see
   * `packages/replica/src/core/reducer.ts`). A plain local entry would have
   * blocked that hydrate, stranding the group page on default config and no
   * members whenever the network was slow, failed or offline.
   */
  internal_updateGroupMaps = (groups: ChatGroupItem[]) => {
    for (const group of groups) {
      this.#groupDetail.update(
        group.id,
        (existing) =>
          existing
            ? ({
                ...existing,
                ...group,

                // Preserve existing agents data
                agents: existing.agents,

                // Keep existing config (authoritative) if present; do not overwrite
                config: existing.config || group.config,
              } as AgentGroupDetail)
            : toAgentGroupDetail(group),
        { persist: false, source: 'seed' },
      );
    }
  };

  /**
   * Refresh the group list. The persisted projection paints as soon as it is
   * read, while the network confirms it in parallel, instead of blanking the
   * list first; the rows then seed `groupMap`.
   *
   * The scope is captured before the first await and threaded through the
   * writes, so a response that resolves after an identity switch is dropped
   * instead of being written (and persisted) into the next scope's partition.
   */
  loadGroups = async () => {
    const scope = this.#captureScope();
    if (!this.#get().groupsInit) await this.#groupList.hydrate(LIST_PARAMS, scope);
    const groups = await chatGroupService.getGroups();
    if (!this.#isStillInScope(scope)) return;

    this.#groupList.replace(LIST_PARAMS, groups, scope);
    this.internal_updateGroupMaps(groups);
  };

  refreshGroupDetail = async (groupId: string) => {
    await this.#groupDetail.revalidate(groupId);
  };

  refreshGroups = async () => {
    await this.#groupList.revalidate(AGENT_GROUP_LIST_KEY);
  };

  toggleGroupSetting = (open: boolean) => {
    this.#set({ showGroupSetting: open }, false, 'toggleGroupSetting');
  };

  toggleThread = (agentId: string) => {
    this.#set({ activeThreadAgentId: agentId }, false, 'toggleThread');
  };

  /**
   * Fetch orchestration only; read the group through `groupMap` /
   * `agentGroupSelectors`. A response of `null` is the settled "gone / no
   * access" state.
   */
  useFetchGroupDetail = (enabled: boolean, groupId: string): ReplicaSyncResult =>
    this.#groupDetail.useSync(groupId ? { groupId } : null, {
      enabled,
      onSuccess: (groupDetail) => {
        if (!groupDetail) {
          this.#removeStaleGroup(groupId);
          this.#markGroupNotFound(groupId);
          return;
        }
        this.#clearGroupNotFound(groupId);
        this.#syncGroupAgents(groupDetail, { onlyIfNewer: true });
      },
    });

  /** Fetch orchestration only; the list seeds `groupMap` through its `onSuccess`. */
  useFetchGroups = (enabled: boolean, isLogin: boolean): ReplicaSyncResult =>
    this.#groupList.useSync(LIST_PARAMS, {
      enabled: enabled && isLogin,
      onSuccess: (groups) => this.internal_updateGroupMaps(groups),
    });
}

type PublicActions<T> = { [K in keyof T]: T[K] };

// Combined action type (public methods only)
export type ChatGroupAction = PublicActions<
  ChatGroupInternalAction & ChatGroupLifecycleAction & ChatGroupMemberAction & ChatGroupCurdAction
>;

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (
  ...params: Parameters<
    StateCreator<ChatGroupStore, [['zustand/devtools', never]], [], ChatGroupAction>
  >
) =>
  flattenActions<ChatGroupAction>([
    new ChatGroupInternalAction(...params),
    new ChatGroupLifecycleAction(...params),
    new ChatGroupMemberAction(...params),
    new ChatGroupCurdAction(...params),
  ]);
