import isEqual from 'fast-deep-equal';
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import type { SidebarAgentItem, SidebarAgentListResponse } from '@/database/repositories/home';
import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { homeService } from '@/services/home';
import type { HomeStore } from '@/store/home/store';
import { setNamespace } from '@/utils/storeDebug';

import { mapResponseToState } from './initialState';

const n = setNamespace('agentList');

const FETCH_AGENT_LIST_KEY = 'fetchAgentList';
const SEARCH_AGENTS_KEY = 'searchAgents';

export interface AgentListAction {
  /**
   * Close all agents drawer
   */
  closeAllAgentsDrawer: () => void;
  /**
   * Open all agents drawer
   */
  openAllAgentsDrawer: () => void;
  /**
   * Refresh the agent list (mutate SWR cache)
   */
  refreshAgentList: () => Promise<void>;
  /**
   * SWR hook to fetch sidebar agent list
   */
  useFetchAgentList: (isLogin: boolean | undefined) => SWRResponse<SidebarAgentListResponse>;
  /**
   * SWR hook to search agents by keyword
   */
  useSearchAgents: (keyword?: string) => SWRResponse<SidebarAgentItem[]>;
}

export const createAgentListSlice: StateCreator<
  HomeStore,
  [['zustand/devtools', never]],
  [],
  AgentListAction
> = (set, get) => ({
  closeAllAgentsDrawer: () => {
    set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  },

  openAllAgentsDrawer: () => {
    set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  },

  refreshAgentList: async () => {
    await mutate([FETCH_AGENT_LIST_KEY, true]);
  },

  useFetchAgentList: (isLogin) =>
    useClientDataSWRWithSync<SidebarAgentListResponse>(
      isLogin === true ? [FETCH_AGENT_LIST_KEY, isLogin] : null,
      () => homeService.getSidebarAgentList(),
      {
        onData: (data) => {
          const state = get();
          const newState = mapResponseToState(data);

          // Skip update if data is the same
          if (
            state.isAgentListInit &&
            isEqual(state.pinnedAgents, newState.pinnedAgents) &&
            isEqual(state.agentGroups, newState.agentGroups) &&
            isEqual(state.ungroupedAgents, newState.ungroupedAgents)
          ) {
            return;
          }

          set(
            {
              ...newState,
              isAgentListInit: true,
            },
            false,
            n('useFetchAgentList/onData'),
          );
        },
      },
    ),

  useSearchAgents: (keyword) =>
    useClientDataSWR<SidebarAgentItem[]>([SEARCH_AGENTS_KEY, keyword], async () => {
      if (!keyword) return [];

      return homeService.searchAgents(keyword);
    }),
});
