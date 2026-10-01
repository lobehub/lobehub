import type { SidebarAgentItem, SidebarAgentListResponse } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentConfigKeys, agentKeys, agentProjectionKeys, isAgentListKey } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { homeService } from '@/services/home';
import { getAgentStoreState } from '@/store/agent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { SidebarAgentMetaPatch } from './initialState';
import { AGENT_LIST_QUERY, agentListProjection, agentListWriteQueue } from './projection';
import type { AgentListDispatchAction } from './reducer';
import { agentListReducer } from './reducer';

const n = setNamespace('agentList');

type Setter = StoreSetter<HomeStore>;
export const createAgentListSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new AgentListActionImpl(set, get, _api);

export class AgentListActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;
  #updateMutationId = 0;

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
    const scope = getCacheScope();
    getAgentStoreState().invalidateAvailableAgents();
    await mutate((key) => isAgentListKey(key, scope));
  };

  internal_dispatchAgentList = (action: AgentListDispatchAction): void => {
    const transition = agentListReducer(this.#get(), action);
    this.#set(transition.state, false, n(`dispatch/${action.type}`));
    for (const effect of transition.effects) {
      agentListWriteQueue.set(
        { queryKey: AGENT_LIST_QUERY, scope: effect.scope },
        { data: effect.data, updatedAt: Date.now() },
      );
    }
  };

  updateAgentMeta = async (id: string, patch: SidebarAgentMetaPatch): Promise<void> => {
    const scope = getCacheScope();
    const mutationId = ++this.#updateMutationId;
    this.internal_dispatchAgentList({ id, mutationId, patch, scope, type: 'optimisticUpdate' });

    try {
      await getAgentStoreState().updateAgentMetaById(id, patch, { rethrow: true });
      this.internal_dispatchAgentList({ id, mutationId, patch, scope, type: 'commitUpdate' });
    } catch (error) {
      this.internal_dispatchAgentList({ id, mutationId, scope, type: 'rollbackUpdate' });
      throw error;
    }
  };

  useFetchAgentList = (isLogin: boolean | undefined): SWRResponse<SidebarAgentListResponse> => {
    const scope = getCacheScope();
    useClientDataSWR(
      isLogin === true ? agentProjectionKeys.listHydration(scope) : null,
      async () => {
        const cached = await agentListProjection.get({ queryKey: AGENT_LIST_QUERY, scope });
        if (cached && getCacheScope() === scope) {
          this.internal_dispatchAgentList({ data: cached.data, scope, type: 'hydrate' });
        }
        return Date.now();
      },
    );

    return useClientDataSWR<SidebarAgentListResponse>(
      isLogin === true ? agentKeys.list(isLogin, scope) : null,
      () => homeService.getSidebarAgentList(),
      {
        onSuccess: (data) => {
          if (getCacheScope() === scope)
            this.internal_dispatchAgentList({ data, scope, type: 'replace' });
        },
      },
    );
  };

  useSearchAgents = (keyword?: string): SWRResponse<SidebarAgentItem[]> => {
    return useClientDataSWR<SidebarAgentItem[]>(agentConfigKeys.search(keyword), async () => {
      if (!keyword) return [];

      return homeService.searchAgents(keyword);
    });
  };
}

export type AgentListAction = Pick<AgentListActionImpl, keyof AgentListActionImpl>;
