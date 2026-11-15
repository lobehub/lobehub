import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { type MarketSkillPackageFile } from '@/services/marketApi';
import { type DiscoverStore } from '@/store/discover';
import { globalHelpers } from '@/store/global/helpers';
import { type StoreSetter } from '@/store/types';
import type {
  AgentForkSourceResponse,
  AgentGroupForkSourceResponse,
  AssistantListResponse,
} from '@/types/discover';
import { setNamespace } from '@/utils/storeDebug';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  agentForkSourceResource,
  agentGroupForkSourceResource,
  type MarketAgentGroupStatus,
  marketAgentGroupStatusResource,
  type MarketAgentStatus,
  marketAgentStatusResource,
  marketIdentifierKey,
  marketUserProfileKey,
  marketUserProfileResource,
  type PluginAgentsParams,
  pluginAgentsQueryKey,
  pluginAgentsResource,
  skillPackageFilesResource,
} from './projection';

const n = setNamespace('discover/market');

/**
 * Several tags of one header (status, fork, review) and every mounted copy of
 * a community header read the same entry. Collapse their mounts into one
 * request; an explicit refresh still goes out.
 */
const SHARED_READ_DEDUPING_INTERVAL = 10_000;

/** Sync flags of a market read, plus the entry key to read it by. */
export interface MarketSyncResult extends ReplicaSyncResult {
  /** A request is in flight and this entry has no value to show yet. */
  isLoading: boolean;
  /** Read the value with `marketSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

/** Page size of the "agents using this plugin" grids. */
export const PLUGIN_AGENTS_PAGE_SIZE = 12;

/** Params of one page of a plugin's agents, in the current UI language. */
export const pluginAgentsParams = (pluginId: string, page: number): PluginAgentsParams => ({
  locale: globalHelpers.getCurrentLanguage(),
  page,
  pageSize: PLUGIN_AGENTS_PAGE_SIZE,
  pluginId,
});

type Setter = StoreSetter<DiscoverStore>;

const toSyncResult = (
  sync: ReplicaSyncResult,
  queryKey: string,
  hasValue: boolean,
  active: boolean,
): MarketSyncResult => ({
  ...sync,
  isLoading: active && !hasValue && (!sync.isHydrated || sync.isValidating),
  queryKey: active ? queryKey : undefined,
});

export const createMarketSlice = (set: Setter, get: () => DiscoverStore, _api?: unknown) =>
  new MarketActionImpl(set, get, _api);

export class MarketActionImpl {
  readonly #agentForkSource;
  readonly #agentGroupForkSource;
  readonly #agentGroupStatus;
  readonly #agentStatus;
  readonly #get: () => DiscoverStore;
  readonly #pluginAgents;
  readonly #skillPackageFiles;
  readonly #userProfile;

  constructor(set: Setter, get: () => DiscoverStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#agentStatus = createReplicaSlice(marketAgentStatusResource, {
      actionPrefix: n('agentStatus'),
      get,
      set,
      stateKey: 'marketAgentStatusReplica',
      view: recordLens<DiscoverStore, MarketAgentStatus>('marketAgentStatusMap'),
    });
    this.#agentGroupStatus = createReplicaSlice(marketAgentGroupStatusResource, {
      actionPrefix: n('agentGroupStatus'),
      get,
      set,
      stateKey: 'marketAgentGroupStatusReplica',
      view: recordLens<DiscoverStore, MarketAgentGroupStatus>('marketAgentGroupStatusMap'),
    });
    this.#agentForkSource = createReplicaSlice(agentForkSourceResource, {
      actionPrefix: n('agentForkSource'),
      get,
      set,
      stateKey: 'agentForkSourceReplica',
      view: recordLens<DiscoverStore, AgentForkSourceResponse>('agentForkSourceMap'),
    });
    this.#agentGroupForkSource = createReplicaSlice(agentGroupForkSourceResource, {
      actionPrefix: n('agentGroupForkSource'),
      get,
      set,
      stateKey: 'agentGroupForkSourceReplica',
      view: recordLens<DiscoverStore, AgentGroupForkSourceResponse>('agentGroupForkSourceMap'),
    });
    this.#pluginAgents = createReplicaSlice(pluginAgentsResource, {
      actionPrefix: n('pluginAgents'),
      get,
      set,
      stateKey: 'pluginAgentsReplica',
      view: recordLens<DiscoverStore, AssistantListResponse>('pluginAgentsMap'),
    });
    this.#skillPackageFiles = createReplicaSlice(skillPackageFilesResource, {
      actionPrefix: n('skillPackageFiles'),
      get,
      set,
      stateKey: 'skillPackageFilesReplica',
      view: recordLens<DiscoverStore, MarketSkillPackageFile[]>('skillPackageFilesMap'),
    });
    this.#userProfile = createReplicaSlice(marketUserProfileResource, {
      actionPrefix: n('userProfile'),
      get,
      // No Market profile for this username (any more): drop the entry and its
      // persisted row instead of painting the old profile.
      isMissing: (profile) => profile === null,
      set,
      stateKey: 'marketUserProfileReplica',
      view: recordLens<DiscoverStore, MarketUserProfile>('marketUserProfileMap'),
    });
  }

  /**
   * Publish status, fork marker and review state of the viewer's own Market
   * agent. Read it with `marketSelectors.agentStatus(queryKey)`. An agent the
   * Market no longer has (NOT_FOUND) drops its entry, memory and persisted row,
   * so the header stops painting a status for it.
   */
  useMarketAgentStatus = (identifier?: string): MarketSyncResult => {
    const active = !!identifier;
    const params = { identifier: identifier ?? '' };
    const queryKey = marketIdentifierKey(params);
    const sync = this.#agentStatus.useSync(active ? params : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
      onError: (error, { key, scope }) => {
        if (key && isTrpcErrorCode(error, 'NOT_FOUND')) this.#agentStatus.remove(key, scope);
      },
      revalidateOnFocus: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().marketAgentStatusMap[queryKey] !== undefined,
      active,
    );
  };

  /** Refetch an agent's Market status after a submission changed it. */
  refreshMarketAgentStatus = async (identifier: string): Promise<void> => {
    await this.#agentStatus.fetch({ identifier }, { fresh: true });
  };

  /** Review state of the viewer's own Market group (`marketSelectors.agentGroupStatus`). */
  useMarketAgentGroupStatus = (identifier?: string): MarketSyncResult => {
    const active = !!identifier;
    const params = { identifier: identifier ?? '' };
    const queryKey = marketIdentifierKey(params);
    const sync = this.#agentGroupStatus.useSync(active ? params : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
      onError: (error, { key, scope }) => {
        if (key && isTrpcErrorCode(error, 'NOT_FOUND')) this.#agentGroupStatus.remove(key, scope);
      },
      revalidateOnFocus: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().marketAgentGroupStatusMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Fork source of an agent (`marketSelectors.agentForkSource`). Pass
   * `enabled: false` until the agent is known to be a fork.
   */
  useAgentForkSource = (identifier?: string, enabled = true): MarketSyncResult => {
    const active = enabled && !!identifier;
    const params = { identifier: identifier ?? '' };
    const queryKey = marketIdentifierKey(params);
    const sync = this.#agentForkSource.useSync(active ? params : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
      revalidateOnFocus: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().agentForkSourceMap[queryKey] !== undefined,
      active,
    );
  };

  /** Fork source of a group (`marketSelectors.agentGroupForkSource`). */
  useAgentGroupForkSource = (identifier?: string, enabled = true): MarketSyncResult => {
    const active = enabled && !!identifier;
    const params = { identifier: identifier ?? '' };
    const queryKey = marketIdentifierKey(params);
    const sync = this.#agentGroupForkSource.useSync(active ? params : null, {
      dedupingInterval: SHARED_READ_DEDUPING_INTERVAL,
      revalidateOnFocus: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().agentGroupForkSourceMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * One page of the agents that use a plugin or skill. The grid walks pages by
   * mounting the next one; read the loaded pages with
   * `marketSelectors.pluginAgentPages(pluginId, pageCount)`.
   */
  usePluginAgents = (pluginId: string | undefined, page: number): MarketSyncResult => {
    const active = !!pluginId;
    const params = pluginAgentsParams(pluginId ?? '', page);
    const queryKey = pluginAgentsQueryKey(params);
    const sync = this.#pluginAgents.useSync(active ? params : null, {
      revalidateOnFocus: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().pluginAgentsMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * Text files of a Market skill package. Disabled for an installed skill,
   * whose files come from the local copy. Read them with
   * `marketSelectors.skillPackageFiles(queryKey)`.
   */
  useSkillPackageFiles = (identifier: string | undefined, enabled = true): MarketSyncResult => {
    const active = enabled && !!identifier;
    const params = { identifier: identifier ?? '' };
    const queryKey = marketIdentifierKey(params);
    const sync = this.#skillPackageFiles.useSync(active ? params : null, {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().skillPackageFilesMap[queryKey] !== undefined,
      active,
    );
  };

  /**
   * The signed-in viewer's Market profile. Read it with
   * `marketSelectors.userProfile(queryKey)`; `undefined` while unloaded or when
   * the account has no Market profile yet.
   */
  useMarketUserProfile = (username: string | null | undefined): MarketSyncResult => {
    const active = !!username;
    const params = { username: username ?? '' };
    const queryKey = marketUserProfileKey(params);
    const sync = this.#userProfile.useSync(active ? params : null, {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
    return toSyncResult(
      sync,
      queryKey,
      active && this.#get().marketUserProfileMap[queryKey] !== undefined,
      active,
    );
  };

  /** Write a profile the server just returned from an edit, memory and persisted row. */
  setMarketUserProfile = (username: string, profile: MarketUserProfile): void => {
    this.#userProfile.update(marketUserProfileKey({ username }), () => profile);
  };
}

export type MarketAction = Pick<MarketActionImpl, keyof MarketActionImpl>;
