import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { type SidebarAgentItem, type SidebarAgentListResponse } from '@/database/repositories/home';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentConfigKeys, projectionKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { homeService } from '@/services/home';
import { getAgentStoreState } from '@/store/agent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { mapResponseToState } from './initialState';

const n = setNamespace('agentList');

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

  /**
   * Migration-only projection for consumers that have not moved to EntityView
   * selectors yet. The canonical Entity Graph remains the sole source; this
   * method performs no request and accepts no partial entity mutation.
   */
  internal_syncAgentListProjection = (
    data: SidebarAgentListResponse | undefined,
    scope: string,
  ): void => {
    const state = this.#get();

    if (!data) {
      if (!state.isAgentListInit && state.agentListScope === scope) return;
      this.#set(
        {
          ...mapResponseToState({
            groups: [],
            pinned: [],
            privateGroups: [],
            privatePinned: [],
            privateUngrouped: [],
            ungrouped: [],
          }),
          agentListScope: scope,
          isAgentListInit: false,
        },
        false,
        n('internal_syncAgentListProjection/clear'),
      );
      return;
    }

    const projection = mapResponseToState(data);
    if (
      state.isAgentListInit &&
      state.agentListScope === scope &&
      isEqual(state.pinnedAgents, projection.pinnedAgents) &&
      isEqual(state.agentGroups, projection.agentGroups) &&
      isEqual(state.ungroupedAgents, projection.ungroupedAgents) &&
      isEqual(state.privateAgentGroups, projection.privateAgentGroups) &&
      isEqual(state.privatePinnedAgents, projection.privatePinnedAgents) &&
      isEqual(state.privateUngroupedAgents, projection.privateUngroupedAgents)
    ) {
      return;
    }

    this.#set(
      { ...projection, agentListScope: scope, isAgentListInit: true },
      false,
      n('internal_syncAgentListProjection'),
    );
  };

  refreshAgentList = async (): Promise<void> => {
    getAgentStoreState().invalidateAvailableAgents();
    await mutate(projectionKeys.sidebar(getCacheScope()));
  };

  useSearchAgents = (keyword?: string): SWRResponse<SidebarAgentItem[]> => {
    return useClientDataSWR<SidebarAgentItem[]>(agentConfigKeys.search(keyword), async () => {
      if (!keyword) return [];

      return homeService.searchAgents(keyword);
    });
  };
}

export type AgentListAction = Pick<AgentListActionImpl, keyof AgentListActionImpl>;
