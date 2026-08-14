import { type AgentGroupDetail } from '@lobechat/types';
import { produce } from 'immer';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';

import { type ChatGroupState } from './initialState';

/**
 * Convert ChatGroupItem to AgentGroupDetail by adding empty agents array
 */
const toAgentGroupDetail = (group: ChatGroupItem): AgentGroupDetail =>
  ({
    ...group,
    agents: [],
  }) as AgentGroupDetail;

export type ChatGroupReducer = (state: ChatGroupState, payload: any) => ChatGroupState;

export const chatGroupReducers = {
  // Add a new group to the list
  addGroup: (state: ChatGroupState, { payload }: { payload: ChatGroupItem }) =>
    produce(state, (draft: ChatGroupState) => {
      draft.groups.push(payload);
      draft.groupMap[payload.id] = toAgentGroupDetail(payload);
    }),

  // Delete a group from the list
  deleteGroup: (state: ChatGroupState, { payload: id }: { payload: string }) =>
    produce(state, (draft: ChatGroupState) => {
      draft.groups = draft.groups.filter((group: ChatGroupItem) => group.id !== id);
      delete draft.groupMap[id];
    }),

  // Load groups into the state
  loadGroups: (state: ChatGroupState, { payload }: { payload: ChatGroupItem[] }) =>
    produce(state, (draft: ChatGroupState) => {
      draft.groups = payload;
      // Rebuild groupMap to maintain consistency, preserving existing agents data
      const currentMap = state.groupMap;
      draft.groupMap = payload.reduce(
        (map, group) => {
          const existing = currentMap[group.id];
          map[group.id] = existing
            ? ({ ...existing, ...group } as AgentGroupDetail)
            : toAgentGroupDetail(group);
          return map;
        },
        {} as Record<string, AgentGroupDetail>,
      );
    }),

  // Update a group in the map
  updateGroup: (
    state: ChatGroupState,
    { payload }: { payload: { id: string; value: Partial<ChatGroupItem> } },
  ) =>
    produce(state, (draft: ChatGroupState) => {
      if (draft.groupMap[payload.id]) {
        Object.assign(draft.groupMap[payload.id], payload.value);
        // Also update in groups array to maintain consistency
        const groupIndex = draft.groups.findIndex(
          (group: ChatGroupItem) => group.id === payload.id,
        );
        if (groupIndex !== -1) {
          Object.assign(draft.groups[groupIndex], payload.value);
        }
      }
    }),
};

export type ChatGroupDispatchPayloads = {
  addGroup: ChatGroupItem;
  deleteGroup: string;
  loadGroups: ChatGroupItem[];
  updateGroup: { id: string; value: Partial<ChatGroupItem> };
};
