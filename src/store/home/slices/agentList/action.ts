import type { SidebarAgentItem, SidebarAgentListResponse, SidebarGroup } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import {
  createReplicaSlice,
  linkReplicaEntity,
  type ReplicaEntityAdapter,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import { homeService } from '@/services/home';
import { getAgentStoreState } from '@/store/agent';
import { type HomeStore } from '@/store/home/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  initialAgentListState,
  mapResponseToState,
  mapStateToResponse,
  type SidebarAgentMetaPatch,
} from './initialState';
import { AGENT_LIST_KEY, agentListResource } from './projection';

const n = setNamespace('agentList');

const LIST_PARAMS = {} as Record<string, never>;

const EMPTY_RESPONSE: SidebarAgentListResponse = mapStateToResponse(initialAgentListState);

/**
 * The sidebar list keeps its long-standing flat fields (`pinnedAgents`,
 * `agentGroups` …) as the replica view, so every selector reads what it did.
 */
const agentListLens: ReplicaLens<HomeStore, SidebarAgentListResponse> = {
  clear: () => ({ ...mapResponseToState(EMPTY_RESPONSE), isAgentListInit: false }),
  get: (state) => (state.isAgentListInit ? mapStateToResponse(state) : undefined),
  keys: (state) => (state.isAgentListInit ? [AGENT_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { ...mapResponseToState(data), isAgentListInit: true }
      : { ...mapResponseToState(EMPTY_RESPONSE), isAgentListInit: false },
};

type ItemFn = (item: SidebarAgentItem) => SidebarAgentItem | undefined;

const mapItems = (items: SidebarAgentItem[], id: string, fn: ItemFn) => {
  if (!items.some((item) => item.id === id)) return items;
  return items.flatMap((item) => {
    if (item.id !== id) return [item];
    const next = fn(item);
    return next ? [next] : [];
  });
};

const mapGroups = (groups: SidebarGroup[], id: string, fn: ItemFn) => {
  if (!groups.some((group) => group.items.some((item) => item.id === id))) return groups;
  return groups.map((group) => {
    const items = mapItems(group.items, id, fn);
    return items === group.items ? group : { ...group, items };
  });
};

/** One agent can sit in any bucket, including a folder of either section. */
const sidebarAgentEntity: ReplicaEntityAdapter<SidebarAgentListResponse, SidebarAgentItem> = {
  has: (data, id) =>
    [data.pinned, data.ungrouped, data.privatePinned, data.privateUngrouped].some((items) =>
      items?.some((item) => item.id === id),
    ) ||
    [data.groups, data.privateGroups].some((groups) =>
      groups?.some((group) => group.items.some((item) => item.id === id)),
    ),
  // Private buckets may be absent on rows persisted before they existed.
  map: (data, id, fn) => ({
    ...data,
    groups: mapGroups(data.groups, id, fn),
    pinned: mapItems(data.pinned, id, fn),
    privateGroups: mapGroups(data.privateGroups ?? [], id, fn),
    privatePinned: mapItems(data.privatePinned ?? [], id, fn),
    privateUngrouped: mapItems(data.privateUngrouped ?? [], id, fn),
    ungrouped: mapItems(data.ungrouped, id, fn),
  }),
};

type Setter = StoreSetter<HomeStore>;
export const createAgentListSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new AgentListActionImpl(set, get, _api);

export class AgentListActionImpl {
  readonly #set: Setter;
  readonly #agentList;
  readonly #agents;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#agentList = createReplicaSlice(agentListResource, {
      actionPrefix: n('agentList'),
      entity: sidebarAgentEntity,
      fetcher: () => homeService.getSidebarAgentList(),
      get,
      // An unchanged list must not re-render every sidebar section.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'agentListReplica',
      view: agentListLens,
    });
    this.#agents = linkReplicaEntity<SidebarAgentItem>([this.#agentList]);
  }

  closeAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: false }, false, n('closeAllAgentsDrawer'));
  };

  openAllAgentsDrawer = (): void => {
    this.#set({ allAgentsDrawerOpen: true }, false, n('openAllAgentsDrawer'));
  };

  refreshAgentList = async (): Promise<void> => {
    getAgentStoreState().invalidateAvailableAgents();
    await this.#agentList.revalidate(AGENT_LIST_KEY);
  };

  /** Rename / re-avatar an agent: the sidebar row changes now, rolls back on failure. */
  updateAgentMeta = async (id: string, patch: SidebarAgentMetaPatch): Promise<void> => {
    await this.#agents.optimistic(
      id,
      (item) => ({ ...item, ...patch }),
      () => getAgentStoreState().updateAgentMetaById(id, patch, { rethrow: true }),
    );
  };

  /** Fetch orchestration only; read the list through `homeAgentListSelectors`. */
  useFetchAgentList = (isLogin: boolean | undefined): ReplicaSyncResult =>
    this.#agentList.useSync(LIST_PARAMS, { enabled: isLogin === true });

  useSearchAgents = (keyword?: string): SWRResponse<SidebarAgentItem[]> => {
    return useClientDataSWR<SidebarAgentItem[]>(agentConfigKeys.search(keyword), async () => {
      if (!keyword) return [];

      return homeService.searchAgents(keyword);
    });
  };
}

export type AgentListAction = Pick<AgentListActionImpl, keyof AgentListActionImpl>;
