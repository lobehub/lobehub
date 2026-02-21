import { type AgentGroupDetail } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { flattenActions } from '@/store/utils/flattenActions';
import { setNamespace } from '@/utils/storeDebug';

import { type ChatGroupState } from './initialState';
import { type ChatGroupDispatchPayloads, type ChatGroupReducer } from './reducers';
import { chatGroupReducers } from './reducers';
import { ChatGroupCurdAction } from './slices/curd';
import { ChatGroupLifecycleAction } from './slices/lifecycle';
import { ChatGroupMemberAction } from './slices/member';

const n = setNamespace('chatGroup');

const FETCH_GROUPS_KEY = 'fetchGroups';
const FETCH_GROUP_DETAIL_KEY = 'fetchGroupDetail';

/**
 * Convert ChatGroupItem to AgentGroupDetail by adding empty agents array if not present
 */
const toAgentGroupDetail = (group: ChatGroupItem): AgentGroupDetail =>
  ({
    ...group,
    agents: [],
  }) as AgentGroupDetail;

type Setter = StoreSetter<ChatGroupStore>;
class ChatGroupInternalAction {
  readonly #get: () => ChatGroupState;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatGroupState, _api?: unknown) {
    // keep signature aligned with StateCreator params: (set, get, api)
    void _api;

    this.#set = set;
    this.#get = get;
  }

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

  internal_fetchGroupDetail = async (groupId: string) => {
    const groupDetail = await chatGroupService.getGroupDetail(groupId);
    if (!groupDetail) return;

    // Update groupMap with full group detail including supervisorAgentId and agents
    this.internal_dispatchChatGroup({
      payload: { id: groupDetail.id, value: groupDetail },
      type: 'updateGroup',
    });

    // Sync group agents to agentStore for builtin agent resolution
    const agentStore = getAgentStoreState();
    for (const agent of groupDetail.agents) {
      agentStore.internal_dispatchAgentMap(agent.id, agent as any);
    }

    // Set activeAgentId to supervisor for correct model resolution
    if (groupDetail.supervisorAgentId) {
      agentStore.setActiveAgentId(groupDetail.supervisorAgentId);
      useChatStore.setState(
        { activeAgentId: groupDetail.supervisorAgentId },
        false,
        'syncActiveAgentIdFromAgentGroup',
      );
    }
  };

  internal_updateGroupMaps = (groups: ChatGroupItem[]) => {
    // Build a candidate map from incoming groups
    const incomingMap = groups.reduce(
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
    const groups = await chatGroupService.getGroups();
    this.internal_dispatchChatGroup({ payload: groups, type: 'loadGroups' });
  };

  refreshGroupDetail = async (groupId: string) => {
    await mutate([FETCH_GROUP_DETAIL_KEY, groupId]);
  };

  refreshGroups = async () => {
    await mutate([FETCH_GROUPS_KEY, true]);
  };

  toggleGroupSetting = (open: boolean) => {
    this.#set({ showGroupSetting: open }, false, 'toggleGroupSetting');
  };

  toggleThread = (agentId: string) => {
    this.#set({ activeThreadAgentId: agentId }, false, 'toggleThread');
  };

  useFetchGroupDetail = (enabled: boolean, groupId: string) =>
    useClientDataSWRWithSync<AgentGroupDetail | null>(
      enabled && groupId ? [FETCH_GROUP_DETAIL_KEY, groupId] : null,
      async () => {
        const groupDetail = await chatGroupService.getGroupDetail(groupId);
        if (!groupDetail) throw new Error(`Group ${groupId} not found`);
        return groupDetail;
      },
      {
        onData: (groupDetail) => {
          if (!groupDetail) return;

          // Update groupMap with detailed group info including agents
          const currentGroup = this.#get().groupMap[groupDetail.id];
          if (isEqual(currentGroup, groupDetail)) return;

          const nextGroupMap = {
            ...this.#get().groupMap,
            [groupDetail.id]: groupDetail,
          };

          this.#set(
            {
              groupMap: nextGroupMap,
            },
            false,
            n('useFetchGroupDetail/onData', { groupId: groupDetail.id }),
          );

          // Sync group agents to agentStore for builtin agent resolution (e.g., supervisor slug)
          // Use smart merge: only overwrite if server data is newer to prevent race conditions
          const agentStore = getAgentStoreState();
          for (const agent of groupDetail.agents) {
            const currentAgentInStore = agentStore.agentMap[agent.id];

            // Only overwrite if:
            // 1. Agent doesn't exist in store
            // 2. Server data is newer than store data (based on updatedAt)
            if (
              !currentAgentInStore ||
              new Date(agent.updatedAt) > new Date(currentAgentInStore.updatedAt || 0)
            ) {
              // AgentGroupMember extends AgentItem which shares fields with LobeAgentConfig
              agentStore.internal_dispatchAgentMap(agent.id, agent as any);
            }
          }

          // Set activeAgentId to supervisor for correct model resolution in sendMessage
          if (groupDetail.supervisorAgentId) {
            agentStore.setActiveAgentId(groupDetail.supervisorAgentId);
            useChatStore.setState(
              { activeAgentId: groupDetail.supervisorAgentId },
              false,
              'syncActiveAgentIdFromAgentGroup',
            );
          }
        },
      },
    );

  // SWR Hooks for data fetching
  // This is not used for now, as we are combining group in the session lambda's response
  useFetchGroups = (enabled: boolean, isLogin: boolean) =>
    useClientDataSWRWithSync<ChatGroupItem[]>(
      enabled ? [FETCH_GROUPS_KEY, isLogin] : null,
      async () => chatGroupService.getGroups(),
      {
        fallbackData: [],
        onData: (groups) => {
          // Update both groups list and groupMap
          const currentMap = this.#get().groupMap;
          const nextGroupMap = groups.reduce(
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
        suspense: true,
      },
    );
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
