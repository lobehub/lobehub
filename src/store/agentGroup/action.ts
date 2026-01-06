import type { AgentGroupDetail } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { getAgentStoreState } from '@/store/agent';
import { type ChatGroupStore } from '@/store/agentGroup/store';
import { useChatStore } from '@/store/chat';
import { setNamespace } from '@/utils/storeDebug';

import { type ChatGroupState } from './initialState';
import { type ChatGroupReducer, chatGroupReducers } from './reducers';
import {
  type ChatGroupCurdAction,
  type ChatGroupLifecycleAction,
  type ChatGroupMemberAction,
  chatGroupCurdSlice,
  chatGroupLifecycleSlice,
  chatGroupMemberSlice,
} from './slices';

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

// Internal action interface
export interface ChatGroupInternalAction {
  internal_dispatchChatGroup: (
    payload:
      | {
          type: string;
        }
      | {
          payload: any;
          type: string;
        },
  ) => void;
  internal_updateGroupMaps: (groups: ChatGroupItem[]) => void;
  loadGroups: () => Promise<void>;
  refreshGroupDetail: (groupId: string) => Promise<void>;
  refreshGroups: () => Promise<void>;
  toggleGroupSetting: (open: boolean) => void;
  toggleThread: (agentId: string) => void;
  useFetchGroupDetail: (enabled: boolean, groupId: string) => any;
  useFetchGroups: (enabled: boolean, isLogin: boolean) => any;
}

// Combined action interface
export interface ChatGroupAction
  extends
    ChatGroupInternalAction,
    ChatGroupLifecycleAction,
    ChatGroupMemberAction,
    ChatGroupCurdAction {}

const chatGroupInternalSlice: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupInternalAction
> = (set, get) => {
  const dispatch: ChatGroupInternalAction['internal_dispatchChatGroup'] = (payload) => {
    set(
      produce((draft: ChatGroupState) => {
        const reducer = chatGroupReducers[
          payload.type as keyof typeof chatGroupReducers
        ] as ChatGroupReducer;
        if (reducer) {
          // Apply the reducer and return the new state
          return reducer(draft, payload);
        }
      }),
      false,
      payload,
    );
  };

  return {
    internal_dispatchChatGroup: dispatch,

    internal_updateGroupMaps: (groups) => {
      // Build a candidate map from incoming groups
      const incomingMap = groups.reduce(
        (map, group) => {
          map[group.id] = group;
          return map;
        },
        {} as Record<string, ChatGroupItem>,
      );

      // Merge with existing map, preserving existing config and agents if present
      const mergedMap = produce(get().groupMap, (draft) => {
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

      set(
        {
          groupMap: mergedMap,
          groupsInit: true,
        },
        false,
        n('internal_updateGroupMaps/chatGroup'),
      );
    },

    loadGroups: async () => {
      const groups = await chatGroupService.getGroups();
      dispatch({ payload: groups, type: 'loadGroups' });
    },

    refreshGroupDetail: async (groupId: string) => {
      await mutate([FETCH_GROUP_DETAIL_KEY, groupId]);
    },

    refreshGroups: async () => {
      await mutate([FETCH_GROUPS_KEY, true]);
    },

    toggleGroupSetting: (open) => {
      set({ showGroupSetting: open }, false, 'toggleGroupSetting');
    },

    toggleThread: (agentId) => {
      set({ activeThreadAgentId: agentId }, false, 'toggleThread');
    },

    useFetchGroupDetail: (enabled, groupId) =>
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
            const currentGroup = get().groupMap[groupDetail.id];
            if (isEqual(currentGroup, groupDetail)) return;

            const nextGroupMap = {
              ...get().groupMap,
              [groupDetail.id]: groupDetail,
            };

            set(
              {
                groupMap: nextGroupMap,
              },
              false,
              n('useFetchGroupDetail/onData', { groupId: groupDetail.id }),
            );

            // Sync group agents to agentStore for builtin agent resolution (e.g., supervisor slug)
            const agentStore = getAgentStoreState();
            for (const agent of groupDetail.agents) {
              // AgentGroupMember extends AgentItem which shares fields with LobeAgentConfig
              agentStore.internal_dispatchAgentMap(agent.id, agent as any);
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
      ),

    // SWR Hooks for data fetching
    // This is not used for now, as we are combining group in the session lambda's response
    useFetchGroups: (enabled, isLogin) =>
      useClientDataSWRWithSync<ChatGroupItem[]>(
        enabled ? [FETCH_GROUPS_KEY, isLogin] : null,
        async () => chatGroupService.getGroups(),
        {
          fallbackData: [],
          onData: (groups) => {
            // Update both groups list and groupMap
            const currentMap = get().groupMap;
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

            if (get().groupsInit && isEqual(currentMap, nextGroupMap)) {
              return;
            }

            set(
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
      ),
  };
};

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (...params) => ({
  ...chatGroupInternalSlice(...params),
  ...chatGroupLifecycleSlice(...params),
  ...chatGroupMemberSlice(...params),
  ...chatGroupCurdSlice(...params),
});
