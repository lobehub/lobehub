import { mutate } from '@/libs/swr';
import { projectionKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { useAgentSearchProjection } from '@/projection/modules/agent/hooks';
import { getAgentStoreState } from '@/store/agent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('agentList');

type Setter = StoreSetter<HomeStore>;
export const createAgentListSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new AgentListActionImpl(set, get, _api);

export class AgentListActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, _get: () => HomeStore, _api?: unknown) {
    void _get;
    void _api;
    this.#set = set;
  }

  closeAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  };

  openAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  };

  refreshAgentList = async (): Promise<void> => {
    getAgentStoreState().invalidateAvailableAgents();
    await mutate(projectionKeys.sidebar(getCacheScope()));
  };

  useSearchAgents = (keyword?: string) => useAgentSearchProjection(keyword);
}

export type AgentListAction = Pick<AgentListActionImpl, keyof AgentListActionImpl>;
