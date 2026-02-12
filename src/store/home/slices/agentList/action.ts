import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { type SidebarAgentItem, type SidebarAgentListResponse } from '@/database/repositories/home';
import { mutate, useClientDataSWR, useClientDataSWRWithSync } from '@/libs/swr';
import { homeService } from '@/services/home';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { mapResponseToState } from './initialState';

const n = setNamespace('agentList');

const FETCH_AGENT_LIST_KEY = 'fetchAgentList';
const SEARCH_AGENTS_KEY = 'searchAgents';

type Setter = StoreSetter<HomeStore>;
export const createAgentListSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new AgentListActionImpl(set, get, _api);

export class AgentListActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  closeAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  };

  openAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  };

  refreshAgentList = async (): Promise<void> => {
    await mutate([FETCH_AGENT_LIST_KEY, true]);
  };

  useFetchAgentList = (isLogin: boolean | undefined): SWRResponse<SidebarAgentListResponse> => {
    return useClientDataSWRWithSync<SidebarAgentListResponse>(
      isLogin === true ? [FETCH_AGENT_LIST_KEY, isLogin] : null,
      () => homeService.getSidebarAgentList(),
      {
        onData: (data) => {
          const state = this.#get();
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

          this.#set(
            {
              ...newState,
              isAgentListInit: true,
            },
            false,
            n('useFetchAgentList/onData'),
          );
        },
      },
    );
  };

  useSearchAgents = (keyword?: string): SWRResponse<SidebarAgentItem[]> => {
    return useClientDataSWR<SidebarAgentItem[]>([SEARCH_AGENTS_KEY, keyword], async () => {
      if (!keyword) return [];

      return homeService.searchAgents(keyword);
    });
  };
}

export type AgentListAction = Pick<AgentListActionImpl, keyof AgentListActionImpl>;
