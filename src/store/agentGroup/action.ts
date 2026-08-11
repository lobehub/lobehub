import {
  type AgentGroupDetail,
  type ChatGroupItem as ProjectionChatGroupItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { groupKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  chatGroupListViewContract,
  getProjectionStoreState,
  nextProjectionObservedAt,
  selectChatGroupDetail,
  selectChatGroupList,
  useProjectionViewHydration,
} from '@/projection';
import { chatGroupService } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { type ResetableStore } from '@/store/utils/resetableStore';
import { setNamespace } from '@/utils/storeDebug';

import { type ChatGroupState, initialChatGroupState } from './initialState';
import { type ChatGroupDispatchPayloads, type ChatGroupReducer } from './reducers';
import { chatGroupReducers } from './reducers';
import { ChatGroupCurdAction } from './slices/curd';
import { ChatGroupLifecycleAction } from './slices/lifecycle';
import { ChatGroupMemberAction } from './slices/member';

const n = setNamespace('chatGroup');

/**
 * Convert ChatGroupItem to AgentGroupDetail by adding empty agents array if not present
 */
const toLegacyChatGroupItem = (group: ProjectionChatGroupItem): ChatGroupItem => ({
  accessedAt: group.accessedAt ?? group.updatedAt,
  avatar: group.avatar ?? null,
  backgroundColor: group.backgroundColor ?? null,
  clientId: group.clientId ?? null,
  config: (group.config as ChatGroupItem['config']) ?? null,
  content: group.content ?? null,
  createdAt: group.createdAt,
  description: group.description ?? null,
  editorData: group.editorData ?? null,
  groupId: group.groupId ?? null,
  id: group.id,
  marketIdentifier: group.marketIdentifier ?? null,
  pinned: group.pinned ?? null,
  title: group.title ?? null,
  updatedAt: group.updatedAt,
  userId: group.userId,
  visibility: group.visibility ?? 'public',
  workspaceId: group.workspaceId ?? null,
});

const toAgentGroupDetail = (group: ChatGroupItem): AgentGroupDetail =>
  ({
    ...group,
    agents: [],
  }) as AgentGroupDetail;

type Setter = StoreSetter<ChatGroupStore>;
class ChatGroupInternalAction implements ResetableStore {
  readonly #get: () => ChatGroupState;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatGroupState, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    this.#get = get;
  }

  reset: ResetableStore['reset'] = () => {
    this.#set(initialChatGroupState, false, n('reset'));
  };

  internal_dispatchChatGroup = <T extends keyof ChatGroupDispatchPayloads>(payload: {
    payload: ChatGroupDispatchPayloads[T];
    type: T;
  }) => {
    this.#set(
      produce((draft: ChatGroupState) => {
        const reducer = chatGroupReducers[payload.type] as ChatGroupReducer | undefined;
        if (reducer) return reducer(draft, payload);
      }),
      false,
      payload,
    );
  };

  private removeStaleGroup = (groupId: string) => {
    this.internal_dispatchChatGroup({ payload: groupId, type: 'deleteGroup' });
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

  internal_fetchGroupDetail = async (groupId: string) => {
    const scope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const groupDetail = await chatGroupService.getGroupDetail(groupId);
    if (!groupDetail) {
      getProjectionStoreState().deleteChatGroupProjection(scope, groupId, observedAt);
      const projectionScope = getProjectionStoreState().scopes[scope];
      const canonical = projectionScope
        ? selectChatGroupDetail(projectionScope, groupId)
        : undefined;
      if (canonical) {
        this.#clearGroupNotFound(groupId);
        this.internal_dispatchChatGroup({
          payload: { id: canonical.id, value: canonical },
          type: 'updateGroup',
        });
        return;
      }
      this.removeStaleGroup(groupId);
      this.#markGroupNotFound(groupId);
      return;
    }
    getProjectionStoreState().commitChatGroupDetail(scope, groupDetail, 'network', observedAt);
    const projectionScope = getProjectionStoreState().scopes[scope];
    const record = projectionScope?.records.chatGroup[groupId];
    if (record?.tombstoneAt) {
      this.removeStaleGroup(groupId);
      this.#markGroupNotFound(groupId);
      return;
    }
    const resolvedGroup = projectionScope
      ? selectChatGroupDetail(projectionScope, groupId)
      : undefined;
    if (!resolvedGroup) return;
    this.#clearGroupNotFound(groupId);

    // Update groupMap with full group detail including supervisorAgentId and agents
    this.internal_dispatchChatGroup({
      payload: { id: resolvedGroup.id, value: resolvedGroup },
      type: 'updateGroup',
    });

    // Sync group agents to agentStore for builtin agent resolution
    const agentStore = getAgentStoreState();
    for (const agent of resolvedGroup.agents) {
      agentStore.internal_dispatchAgentMap(agent.id, agent as any, { commitProjection: false });
    }

    // Set activeAgentId to supervisor for correct model resolution
    if (resolvedGroup.supervisorAgentId) {
      agentStore.setActiveAgentId(resolvedGroup.supervisorAgentId);
      useChatStore.setState(
        { activeAgentId: resolvedGroup.supervisorAgentId },
        false,
        'syncActiveAgentIdFromAgentGroup',
      );
    }
  };

  internal_updateGroupMaps = (groups: ChatGroupItem[]) => {
    const scope = getCacheScope();
    const projectionStore = getProjectionStoreState();
    // Session rows are an indirect, partial ChatGroup source. They may seed an
    // empty Projection, but must never outrank a typed ChatGroup request or a
    // local edit that already owns the entity.
    projectionStore.commitChatGroups(scope, groups, 0);
    const canonicalGroups = selectChatGroupList(getProjectionStoreState().scopes[scope]);
    if (!canonicalGroups) return;
    const resolvedGroups = canonicalGroups.map(toLegacyChatGroupItem);
    // Build a candidate map from incoming groups
    const incomingMap = resolvedGroups.reduce(
      (map, group) => {
        map[group.id] = group;
        return map;
      },
      {} as Record<string, ChatGroupItem>,
    );

    // Merge with existing map, preserving existing config and agents if present
    const mergedMap = produce(this.#get().groupMap, (draft) => {
      for (const id of Object.keys(incomingMap)) {
        const incoming = incomingMap[id];
        const existing = draft[id];
        if (existing) {
          draft[id] = {
            ...existing,
            ...incoming,

            // Preserve existing agents data
            agents: existing.agents,

            // Keep existing config (authoritative) if present; do not overwrite
            config: existing.config || incoming.config,
          } as AgentGroupDetail;
        } else {
          draft[id] = toAgentGroupDetail(incoming);
        }
      }
    });

    this.#set(
      {
        groupMap: mergedMap,
        groupsInit: true,
      },
      false,
      n('internal_updateGroupMaps/chatGroup'),
    );
  };

  loadGroups = async () => {
    const scope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const groups = await chatGroupService.getGroups();
    getProjectionStoreState().commitChatGroups(scope, groups, observedAt);
    const canonicalGroups = selectChatGroupList(getProjectionStoreState().scopes[scope]);
    if (!canonicalGroups) return;
    const resolvedGroups = canonicalGroups.map(toLegacyChatGroupItem);
    this.internal_dispatchChatGroup({ payload: resolvedGroups, type: 'loadGroups' });
  };

  refreshGroupDetail = async (groupId: string) => {
    await mutate(groupKeys.detail(groupId));
  };

  refreshGroups = async () => {
    await mutate(groupKeys.list(true));
  };

  toggleGroupSetting = (open: boolean) => {
    this.#set({ showGroupSetting: open }, false, 'toggleGroupSetting');
  };

  toggleThread = (agentId: string) => {
    this.#set({ activeThreadAgentId: agentId }, false, 'toggleThread');
  };

  useFetchGroupDetail = (enabled: boolean, groupId: string) => {
    const request = useClientDataSWRWithSync<AgentGroupDetail | null>(
      enabled && groupId ? groupKeys.detail(groupId) : null,
      async () => {
        const scope = getCacheScope();
        const observedAt = nextProjectionObservedAt();
        const groupDetail = await chatGroupService.getGroupDetail(groupId);
        // Resolve to null instead of throwing: "gone / no access" is a settled
        // terminal state (rendered as a 404 card), not a retryable error.
        if (!groupDetail) {
          getProjectionStoreState().deleteChatGroupProjection(scope, groupId, observedAt);
          return null;
        }
        getProjectionStoreState().commitChatGroupDetail(scope, groupDetail, 'network', observedAt);
        return groupDetail;
      },
      {
        onData: (groupDetail) => {
          if (!groupDetail) {
            const projectionScope = getProjectionStoreState().scopes[getCacheScope()];
            const canonical = projectionScope
              ? selectChatGroupDetail(projectionScope, groupId)
              : undefined;
            if (canonical) {
              this.#clearGroupNotFound(groupId);
              return;
            }
            this.removeStaleGroup(groupId);
            this.#markGroupNotFound(groupId);
            return;
          }
          const projectionStore = getProjectionStoreState();
          const scope = getCacheScope();
          let projectionScope = projectionStore.scopes[scope];
          let canonical = projectionScope
            ? selectChatGroupDetail(projectionScope, groupId)
            : undefined;
          const record = projectionScope?.records.chatGroup[groupId];
          if (!canonical && !record?.tombstoneAt) {
            projectionStore.commitChatGroupDetail(scope, groupDetail, 'network', 0);
            projectionScope = getProjectionStoreState().scopes[scope];
            canonical = projectionScope
              ? selectChatGroupDetail(projectionScope, groupId)
              : undefined;
          }
          if (projectionScope?.records.chatGroup[groupId]?.tombstoneAt) {
            this.#markGroupNotFound(groupId);
            return;
          }
          const resolvedGroup = canonical;
          if (!resolvedGroup) return;
          this.#clearGroupNotFound(groupId);

          // Update groupMap with detailed group info including agents
          const currentGroup = this.#get().groupMap[resolvedGroup.id];
          if (isEqual(currentGroup, resolvedGroup)) return;

          const nextGroupMap = {
            ...this.#get().groupMap,
            [resolvedGroup.id]: resolvedGroup,
          };

          this.#set(
            {
              groupMap: nextGroupMap,
            },
            false,
            n('useFetchGroupDetail/onData', { groupId: resolvedGroup.id }),
          );

          // Sync group agents to agentStore for builtin agent resolution (e.g., supervisor slug)
          // Use smart merge: only overwrite if server data is newer to prevent race conditions
          const agentStore = getAgentStoreState();
          for (const agent of resolvedGroup.agents) {
            const currentAgentInStore = agentStore.agentMap[agent.id];

            // Only overwrite if:
            // 1. Agent doesn't exist in store
            // 2. Server data is newer than store data (based on updatedAt)
            if (
              !currentAgentInStore ||
              new Date(agent.updatedAt) > new Date(currentAgentInStore.updatedAt || 0)
            ) {
              // AgentGroupMember extends AgentItem which shares fields with LobeAgentConfig
              agentStore.internal_dispatchAgentMap(agent.id, agent as any, {
                commitProjection: false,
              });
            }
          }

          // Set activeAgentId to supervisor for correct model resolution in sendMessage
          if (resolvedGroup.supervisorAgentId) {
            agentStore.setActiveAgentId(resolvedGroup.supervisorAgentId);
            useChatStore.setState(
              { activeAgentId: resolvedGroup.supervisorAgentId },
              false,
              'syncActiveAgentIdFromAgentGroup',
            );
          }
        },
        syncBeforePaint: true,
      },
    );

    return request;
  };

  // SWR Hooks for data fetching
  // This is not used for now, as we are combining group in the session lambda's response
  useFetchGroups = (enabled: boolean, isLogin: boolean) => {
    useProjectionViewHydration(chatGroupListViewContract, {}, enabled);
    return useClientDataSWRWithSync<ChatGroupItem[]>(
      enabled ? groupKeys.list(isLogin) : null,
      async () => {
        const scope = getCacheScope();
        const observedAt = nextProjectionObservedAt();
        const groups = await chatGroupService.getGroups();
        getProjectionStoreState().commitChatGroups(scope, groups, observedAt);
        return groups;
      },
      {
        fallbackData: [],
        onData: (groups) => {
          const projectionStore = getProjectionStoreState();
          const scope = getCacheScope();
          if (!selectChatGroupList(projectionStore.scopes[scope])) {
            projectionStore.commitChatGroups(scope, groups, 0);
          }
          const selectedGroups = selectChatGroupList(getProjectionStoreState().scopes[scope]);
          if (!selectedGroups) return;
          const canonicalGroups = selectedGroups.map(toLegacyChatGroupItem);
          // Update both groups list and groupMap
          const currentMap = this.#get().groupMap;
          const nextGroupMap = canonicalGroups.reduce(
            (map, group) => {
              // Preserve existing agents data if available
              const existing = currentMap[group.id];
              map[group.id] = existing
                ? ({ ...existing, ...group } as AgentGroupDetail)
                : toAgentGroupDetail(group);
              return map;
            },
            {} as Record<string, AgentGroupDetail>,
          );

          if (this.#get().groupsInit && isEqual(currentMap, nextGroupMap)) {
            return;
          }

          this.#set(
            {
              groupMap: nextGroupMap,
              groupsInit: true,
            },
            false,
            n('useFetchGroups/onData'),
          );
        },
        syncBeforePaint: true,
      },
    );
  };
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
