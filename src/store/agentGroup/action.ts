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
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
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
 * Where a seed row comes from. A `list` row is the server's group list row; a
 * `session` row is synthesized from a session and only its real fields count.
 */
export type GroupSeedSource = 'list' | 'session';

/**
 * The fields a session-derived group row actually carries. The rest of that row
 * is placeholders (`workspaceId: null`, `visibility: 'public'`, `userId: ''`, …)
 * that must never overwrite a real detail — e.g. turn a workspace group personal.
 */
const SESSION_GROUP_FIELDS = [
  'createdAt',
  'description',
  'groupId',
  'pinned',
  'title',
  'updatedAt',
] as const satisfies readonly (keyof ChatGroupItem)[];

const pickSessionFields = (group: ChatGroupItem): Partial<ChatGroupItem> => {
  const picked: Partial<ChatGroupItem> = {};
  for (const field of SESSION_GROUP_FIELDS) {
    if (group[field] !== undefined) (picked as Record<string, unknown>)[field] = group[field];
  }
  return picked;
};

/**
 * Fold a list row into a group detail: the row's metadata (title, avatar, …)
 * wins, while a loaded roster (`agents`) and an authoritative `config` are kept.
 *
 * Every list seed goes through this merge, and the detail replica replays it
 * when the persisted detail hydrates over the seed — so a fresher list row's
 * metadata is not regressed to the persisted detail's, and the persisted roster
 * and config are not dropped for the row's empty ones.
 */
const mergeListRow = (
  existing: AgentGroupDetail | undefined,
  group: ChatGroupItem,
  source: GroupSeedSource = 'list',
): AgentGroupDetail =>
  existing
    ? ({
        ...existing,
        ...(source === 'session' ? pickSessionFields(group) : group),
        agents: existing.agents,
        config: existing.config || group.config,
      } as AgentGroupDetail)
    : toAgentGroupDetail(group);

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
  /**
   * Ids the last authoritative list `replace` dropped. A group can live in the
   * persisted list without ever being seeded into `groupMap` (a reload hydrates
   * the list only), so the detail reconcile prunes these as well — see
   * {@link #reconcileGroupMap}.
   */
  #droppedGroupIds: string[] = [];
  /** Bumped by every `loadGroups`; a late reconcile only runs for the latest. */
  #listLoadSeq = 0;
  /** The hydrate a starting `loadGroups` request waits for (see the list fetcher). */
  #listHydration: Promise<boolean> | undefined;

  constructor(set: Setter, get: () => ChatGroupStore, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    this.#get = get;
    this.#groupList = createReplicaSlice(agentGroupListResource, {
      actionPrefix: 'agentGroupList',
      // The authoritative list reconciles `groupMap`, whichever path fetched
      // it (the mounted sync or `loadGroups`).
      effects: { onApplied: (groups) => this.#reconcileGroupMap(groups) },
      entity: agentGroupsEntity,
      fetcher: async () => {
        // The persisted-list hydrate `loadGroups` started alongside this
        // request (captured now, see there).
        const hydration = this.#listHydration;
        const groups = await chatGroupService.getGroups();
        // Let a hydrate that is about to land paint first — the list `merge`
        // reads the hydrated rows to learn which ids the response drops — but
        // never let a stalled storage read hold back an authoritative response
        // that already arrived: creation flows await `loadGroups()` before
        // they navigate. A hydrate that lands after the replace is a no-op (it
        // only fills an empty slot).
        if (hydration) await settleWithin(hydration, PRE_PAINT_HYDRATE_TIMEOUT);
        return groups;
      },
      get,
      // The list is the authoritative parent of every detail, so remember the
      // rows a `replace` drops: a group that only ever hydrated from the
      // persisted list never reached `groupMap`, and its detail must still be
      // pruned (see `#reconcileGroupMap`). Returning `incoming` keeps the
      // default "the response is the value".
      merge: (incoming, confirmed) => {
        const nextIds = new Set(incoming.map((group) => group.id));
        this.#droppedGroupIds = (confirmed ?? [])
          .map((group) => group.id)
          .filter((id) => !nextIds.has(id));
        return incoming;
      },
      set,
      stateKey: 'agentGroupListReplica',
      view: groupsLens,
    });
    this.#groupDetail = createReplicaSlice(agentGroupDetailResource, {
      actionPrefix: 'agentGroupDetail',
      // Resource-level, so every response settles them — a mounted sync (even
      // one the hook has moved past, whose own callback is skipped) and
      // `internal_fetchGroupDetail` alike. `null` is a terminal "gone / no
      // access" answer: the replica removes the detail in the scope the
      // request started under, and these drop the group from the other views.
      effects: {
        onApplied: (_detail, { groupId }) => this.#clearGroupNotFound(groupId),
        onMissing: ({ groupId }) => {
          this.#removeStaleGroup(groupId);
          this.#markGroupNotFound(groupId);
        },
        // A scope left behind keeps its view untouched — it is not on screen —
        // but its persisted list row drops the group too, so switching back
        // cannot hydrate it into the sidebar (indefinitely, offline, until
        // `getGroups()` answers). The replica already purged its detail row.
        onPurge: ({ groupId }, { scope }) => this.#groupRows.remove(groupId, { scope }),
      },
      entity: agentGroupDetailEntity,
      fetcher: ({ groupId }) => chatGroupService.getGroupDetail(groupId),
      get,
      isMissing: (incoming) => !incoming,
      // The endpoint returns the complete, authoritative detail. An unchanged
      // detail keeps its reference so the group pages do not re-render.
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

  #removeStaleGroup = (groupId: string) => {
    const loaded = this.#get().groupMap[groupId] !== undefined;
    this.#groupRows.remove(groupId);
    // The entity removal only dispatches for a loaded detail. Remove the key
    // itself otherwise, so a detail request already in flight for it is
    // invalidated too (and cannot recreate the group once it answers).
    if (!loaded) this.#groupDetail.remove(groupId);
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

  /**
   * The side effects of a group detail that resolved successfully, whether it
   * came from the network or from the persisted replica: adopt the roster and
   * supervisor, and settle the not-found state (`null` is the settled "gone /
   * no access" state). Running it off the hydrated value too is what lets a
   * cold start with a slow / failed / offline network paint a usable group page
   * instead of an empty roster behind the 404 guard.
   */
  #applyGroupDetail = (groupId: string, groupDetail: AgentGroupDetail | null | undefined) => {
    if (!groupDetail) {
      this.#removeStaleGroup(groupId);
      this.#markGroupNotFound(groupId);
      return;
    }
    this.#clearGroupNotFound(groupId);
    this.#syncGroupAgents(groupDetail, { onlyIfNewer: true });
  };

  /**
   * Re-read a group's detail after a write, with or without a mounted page.
   * `fresh`: a request already in flight may hold the pre-write roster. The
   * replica applies the scope / removal / clear guards and settles a terminal
   * absence (see the slice `effects`); an applied detail is an explicit
   * refresh, so its roster always takes the server value.
   */
  internal_fetchGroupDetail = async (groupId: string) => {
    const { applied, data } = await this.#groupDetail.fetch({ groupId }, { fresh: true });
    if (applied && data) this.#syncGroupAgents(data);
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
    this.#groupDetail.update(group.id, (existing) => mergeListRow(existing, group), {
      persist: false,
      seedTag: 'list',
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
   *
   * This only merges; it never prunes. It is also called with a partial set
   * (the group sessions the session list carries), so a caller that holds the
   * complete group list prunes through {@link #reconcileGroupMap} instead.
   *
   * The seeds are applied as ONE batched replica write: doing it per row would
   * clone `groupMap` and notify subscribers once per group.
   */
  internal_updateGroupMaps = (groups: ChatGroupItem[], source: GroupSeedSource = 'list') => {
    this.#groupDetail.updateMany(
      groups.map((group) => ({
        apply: (existing) => mergeListRow(existing, group, source),
        key: group.id,
      })),
      // One tag per source: a refresh supersedes that source's earlier seed.
      { persist: false, seedTag: source, source: 'seed' },
    );
  };

  /**
   * Fold the complete, authoritative group list into `groupMap`: every detail
   * the list no longer carries (the group was deleted, or the caller lost
   * access) is pruned from memory and from the persisted replica, then the
   * returned rows are merged in. Without the prune a removed group keeps
   * resolving its metadata and permissions (e.g. the supervisor fallback) even
   * though `getGroups()` stopped listing it.
   *
   * The candidates are not just `groupMap`: after a reload the persisted list
   * hydrates groups without seeding `groupMap`, so a group the authoritative
   * response drops would otherwise keep its persisted detail and paint on a
   * later slow / offline visit. `#droppedGroupIds` carries those ids from the
   * list replace. A stale candidate is harmless — only ids *absent from the
   * authoritative list* are ever removed.
   */
  #reconcileGroupMap = (groups: ChatGroupItem[]) => {
    const listedIds = new Set(groups.map((group) => group.id));
    const candidates = new Set([...Object.keys(this.#get().groupMap), ...this.#droppedGroupIds]);
    this.#droppedGroupIds = [];

    for (const groupId of candidates) {
      if (!listedIds.has(groupId)) this.#removeStaleGroup(groupId);
    }
    this.internal_updateGroupMaps(groups);
  };

  /**
   * Refresh the group list. The persisted projection paints as soon as it is
   * read, while the network confirms it in parallel, instead of blanking the
   * list first; the rows then seed `groupMap`.
   *
   * The request is started before the hydration read is awaited: the two are
   * independent, and a caller such as `sendAsGroup` awaits `loadGroups()` before
   * it navigates, so serializing them only delays both. Hydration still paints
   * the persisted list as soon as it resolves; a bounded wait for it before the
   * replace keeps that paint ahead of the network's without letting a stalled
   * storage read block the response.
   *
   * The scope is captured before the first await and threaded through the
   * writes, so a response that resolves after an identity switch is dropped
   * instead of being written (and persisted) into the next scope's partition.
   */
  loadGroups = async () => {
    const scope = cacheScope.get();
    // Drop the previous identity's list before anything else. After a workspace
    // switch the store stays mounted with `groupsInit` still true, so without
    // this the old workspace's groups linger through a slow / failed request and
    // the new scope's persisted list is never read — which in turn leaves the
    // detail reconcile blind to the persisted-only ids a response omits.
    this.#groupList.ensureScope(scope);
    const load = ++this.#listLoadSeq;
    const hydration = this.#get().groupsInit
      ? undefined
      : this.#groupList.hydrate(LIST_PARAMS, scope).finally(() => (hydrated = true));
    let hydrated = !hydration;
    // The persisted list ids, read alongside the hydrate. If the hydrate misses
    // the bound the fetcher waits for, the list `replace` cannot see which ids
    // the response dropped (see `#droppedGroupIds`), so those are pruned from
    // this snapshot.
    const persistedIds = hydration ? this.#readPersistedGroupIds(scope) : undefined;
    // The request starts synchronously and captures the hydrate to wait for.
    // `fresh`: creation flows call this right after a write.
    this.#listHydration = hydration;
    const fetched = this.#groupList.fetch(LIST_PARAMS, { fresh: true });
    this.#listHydration = undefined;
    // Dropped by the replica (an identity switch, a clear) — and with it the
    // reconcile that `effects.onApplied` runs for an applied list.
    const { applied, data: groups } = await fetched;
    if (!applied) return;

    if (!hydrated && persistedIds) {
      const listedIds = new Set(groups.map((group) => group.id));
      void persistedIds.then((ids) => {
        // A newer list load (or an identity switch) owns the reconcile now.
        if (load !== this.#listLoadSeq || cacheScope.get() !== scope) return;
        const current = new Set(this.#get().groups.map((group) => group.id));
        for (const id of ids) {
          if (!listedIds.has(id) && !current.has(id)) this.#removeStaleGroup(id);
        }
      });
    }
  };

  /** Ids of the persisted group list in `scope` (empty when unreadable). */
  #readPersistedGroupIds = async (scope: string): Promise<string[]> => {
    try {
      const row = await agentGroupListResource.storage?.get({
        queryKey: agentGroupListResource.storageKey(LIST_PARAMS),
        scope,
      });
      return (row?.data ?? []).map((group) => group.id);
    } catch {
      return [];
    }
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
   * access" state. The detail also hydrates from the persisted replica with no
   * response, so the same side effects run off the hydrated value as well.
   */
  useFetchGroupDetail = (enabled: boolean, groupId: string): ReplicaSyncResult =>
    this.#groupDetail.useSync(groupId ? { groupId } : null, {
      enabled,
      onHydrated: (groupDetail) => this.#applyGroupDetail(groupId, groupDetail),
      // Not found is settled by the slice `effects`; this view adopts the roster.
      onSuccess: (groupDetail) => {
        if (groupDetail) this.#applyGroupDetail(groupId, groupDetail);
      },
    });

  /**
   * Fetch orchestration only; the authoritative list reconciles `groupMap`
   * through the slice `effects`.
   */
  useFetchGroups = (enabled: boolean, isLogin: boolean): ReplicaSyncResult =>
    this.#groupList.useSync(LIST_PARAMS, { enabled: enabled && isLogin });
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
