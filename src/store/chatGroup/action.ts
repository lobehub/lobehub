import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import { mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import type { ChatGroupItem } from '@/database/schemas/chatGroup';
import { useClientDataSWR } from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import type { ChatStoreState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';
import { getSessionStoreState } from '@/store/session';
import { setNamespace } from '@/utils/storeDebug';

import {
  ChatGroupAction,
  ChatGroupState,
  ChatGroupStore,
  initialChatGroupState,
} from './initialState';
import { ChatGroupReducer, chatGroupReducers } from './reducers';
import { chatGroupSelectors } from './selectors';

const n = setNamespace('chatGroup');

const FETCH_GROUPS_KEY = 'fetchGroups';
const FETCH_GROUP_DETAIL_KEY = 'fetchGroupDetail';

const syncChatStoreGroupMap = (groupMap: Record<string, ChatGroupItem>) => {
  useChatStore.setState(
    produce((state: ChatStoreState) => {
      state.groupMaps = groupMap;
      state.groupsInit = true;
    }),
    false,
    n('syncGroupMap/chat'),
  );
};

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (set, get) => {
  const dispatch: ChatGroupAction['internal_dispatchChatGroup'] = (payload) => {
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
    ...initialChatGroupState,

    addAgentsToGroup: async (groupId, agentIds) => {
      await chatGroupService.addAgentsToGroup(groupId, agentIds);
      await get().internal_refreshGroups();
    },

    /**
     * @param silent - if true, do not switch to the new group session
     */
    createGroup: async (newGroup, agentIds, silent = false) => {
      const { switchSession } = getSessionStoreState();

      const group = await chatGroupService.createGroup(newGroup);

      if (agentIds && agentIds.length > 0) {
        await chatGroupService.addAgentsToGroup(group.id, agentIds);

        // Wait a brief moment to ensure database transactions are committed
        // This prevents race condition where loadGroups() executes before member addition is fully persisted
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });
      }

      dispatch({ payload: group, type: 'addGroup' });

      await get().loadGroups();
      await getSessionStoreState().refreshSessions();

      if (!silent) {
        switchSession(group.id);
      }

      return group.id;
    },
    deleteGroup: async (id) => {
      // First, get all group members to identify virtual members
      // Note: ChatGroupAgentItem type is incorrectly defined in schema as agents table type
      // but getGroupAgents actually returns chatGroupsAgents junction table entries
      const groupAgents = (await chatGroupService.getGroupAgents(id)) as unknown as Array<{
        agentId: string;
        chatGroupId: string;
      }>;

      // Delete the group first (this will cascade delete the chat_groups_agents entries)
      await chatGroupService.deleteGroup(id);
      dispatch({ payload: id, type: 'deleteGroup' });

      // Now delete virtual members (agents with virtual: true)
      const sessionStore = getSessionStoreState();
      const sessions = sessionStore.sessions || [];

      // Find and delete all virtual sessions that were members of this group
      const virtualMemberDeletions = groupAgents
        .map((groupAgent) => {
          // groupAgent has agentId property from the junction table
          const session = sessions.find((s) => {
            // Type guard: check if it's an agent session
            if (s.type === 'agent') {
              return s.config?.id === groupAgent.agentId;
            }
            return false;
          });

          // Only delete if the session exists and has virtual flag set to true
          if (session && session.type === 'agent' && session.config?.virtual) {
            return sessionStore.removeSession(session.id);
          }
          return null;
        })
        .filter(Boolean);

      // Wait for all virtual member deletions to complete
      await Promise.all(virtualMemberDeletions);

      await get().loadGroups();
      await getSessionStoreState().refreshSessions();

      // If the active session is the deleted group, switch to the inbox session
      if (sessionStore.activeId === id) {
        sessionStore.switchSession(INBOX_SESSION_ID);
      }
    },

    internal_dispatchChatGroup: dispatch,

    internal_refreshGroups: async () => {
      await get().loadGroups();

      // Also rebuild and update groupMap to keep it in sync
      const groups = await chatGroupService.getGroups();
      const nextGroupMap = groups.reduce(
        (map, group) => {
          map[group.id] = group;
          return map;
        },
        {} as Record<string, ChatGroupItem>,
      );

      if (!isEqual(get().groupMap, nextGroupMap)) {
        set(
          {
            groupMap: nextGroupMap,
            groupsInit: true,
            isGroupsLoading: false,
          },
          false,
          n('internal_refreshGroups/updateGroupMap'),
        );

        syncChatStoreGroupMap(nextGroupMap);
      }

      // Refresh sessions so session-related group info stays up to date
      await getSessionStoreState().refreshSessions();
    },

    internal_updateGroupMaps: (groups) => {
      // Build a candidate map from incoming groups
      const incomingMap = groups.reduce(
        (map, group) => {
          map[group.id] = group;
          return map;
        },
        {} as Record<string, ChatGroupItem>,
      );

      // Merge with existing map, preserving existing config if present
      const mergedMap = produce(get().groupMap, (draft) => {
        for (const id of Object.keys(incomingMap)) {
          const incoming = incomingMap[id];
          const existing = draft[id];
          if (existing) {
            draft[id] = {
              ...existing,
              ...incoming,
              // Keep existing config (authoritative) if present; do not overwrite
              config: existing.config || incoming.config,
            } as ChatGroupItem;
          } else {
            draft[id] = incoming;
          }
        }
      });

      set(
        {
          groupMap: mergedMap,
          groupsInit: true,
          isGroupsLoading: false,
        },
        false,
        n('internal_updateGroupMaps/chatGroup'),
      );

      syncChatStoreGroupMap(mergedMap);
    },

    loadGroups: async () => {
      dispatch({ payload: true, type: 'setGroupsLoading' });
      const groups = await chatGroupService.getGroups();
      dispatch({ payload: groups, type: 'loadGroups' });
    },

    pinGroup: async (id, pinned) => {
      await chatGroupService.updateGroup(id, { pinned });
      dispatch({ payload: { id, pinned }, type: 'updateGroup' });
      await get().internal_refreshGroups();
    },

    refreshGroupDetail: async (groupId: string) => {
      await mutate([FETCH_GROUP_DETAIL_KEY, groupId]);
    },

    refreshGroups: async () => {
      await mutate([FETCH_GROUPS_KEY, true]);
    },

    removeAgentFromGroup: async (groupId, agentId) => {
      await chatGroupService.removeAgentsFromGroup(groupId, [agentId]);
      await get().internal_refreshGroups();
    },

    reorderGroupMembers: async (groupId, orderedAgentIds) => {
      console.log('REORDER GROUP MEMBERS', groupId, orderedAgentIds);

      await Promise.all(
        orderedAgentIds.map((agentId, index) =>
          chatGroupService.updateAgentInGroup(groupId, agentId, { order: index }),
        ),
      );

      await get().internal_refreshGroups();
    },

    toggleGroupSetting: (open) => {
      set({ showGroupSetting: open }, false, 'toggleGroupSetting');
    },

    toggleThread: (agentId) => {
      set({ activeThreadAgentId: agentId }, false, 'toggleThread');
    },

    updateGroup: async (id, value) => {
      await chatGroupService.updateGroup(id, value);
      dispatch({ payload: { id, value }, type: 'updateGroup' });
      await get().internal_refreshGroups();
    },

    updateGroupConfig: async (config) => {
      const group = chatGroupSelectors.currentGroup(get());
      if (!group) return;

      const mergedConfig = {
        ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        ...group.config,
        ...config,
      };

      // Update the database first
      await chatGroupService.updateGroup(group.id, { config: mergedConfig });

      // Immediately update the local store to ensure configuration is available
      // Note: reducer expects payload: { id, value }
      dispatch({
        payload: { id: group.id, value: { config: mergedConfig } },
        type: 'updateGroup',
      });

      // Also update the chat store's groupMaps to keep it in sync
      useChatStore.setState(
        produce((draft: ChatStoreState) => {
          const existing = draft.groupMaps[group.id];
          if (existing) {
            draft.groupMaps[group.id] = {
              ...existing,
              config: mergedConfig,
            } as ChatGroupItem;
          }
        }),
        false,
        n('updateGroupConfig/syncChatStore'),
      );

      // Refresh groups to ensure consistency
      await get().internal_refreshGroups();
    },

    updateGroupMeta: async (meta) => {
      const group = chatGroupSelectors.currentGroup(get());
      if (!group) return;

      const id = group.id;

      await chatGroupService.updateGroup(id, meta);
      // Keep local store in sync immediately
      dispatch({ payload: { id, value: meta }, type: 'updateGroup' });
      await get().internal_refreshGroups();
    },

    useFetchGroupDetail: (enabled, groupId) =>
      useClientDataSWR<ChatGroupItem>(
        enabled && groupId ? [FETCH_GROUP_DETAIL_KEY, groupId] : null,
        async ([, id]) => {
          const group = await chatGroupService.getGroup(id as string);
          if (!group) throw new Error(`Group ${id} not found`);
          return group;
        },
        {
          onSuccess: (group) => {
            // Update groupMap with detailed group info
            const currentGroup = get().groupMap[group.id];
            if (isEqual(currentGroup, group)) return;

            const nextGroupMap = {
              ...get().groupMap,
              [group.id]: group,
            };

            set(
              {
                groupMap: nextGroupMap,
              },
              false,
              n('useFetchGroupDetail/onSuccess', { groupId: group.id }),
            );

            syncChatStoreGroupMap(nextGroupMap);
          },
        },
      ),

    // SWR Hooks for data fetching
    // This is not used for now, as we are combining group in the session lambda's response
    useFetchGroups: (enabled, isLogin) =>
      useClientDataSWR<ChatGroupItem[]>(
        enabled ? [FETCH_GROUPS_KEY, isLogin] : null,
        async () => chatGroupService.getGroups(),
        {
          fallbackData: [],
          onSuccess: (groups) => {
            // Update both groups list and groupMap
            const incomingMap = groups.reduce(
              (map, group) => {
                map[group.id] = group;
                return map;
              },
              {} as Record<string, ChatGroupItem>,
            );

            const currentMap = get().groupMap;
            const nextGroupMap = { ...currentMap, ...incomingMap };

            if (get().groupsInit && isEqual(currentMap, nextGroupMap)) {
              return;
            }

            set(
              {
                groupMap: nextGroupMap,
                groupsInit: true,
                isGroupsLoading: false,
              },
              false,
              n('useFetchGroups/onSuccess'),
            );

            syncChatStoreGroupMap(nextGroupMap);
          },
          suspense: true,
        },
      ),
  };
};
