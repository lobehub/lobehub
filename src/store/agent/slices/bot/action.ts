import {
  createReplicaSlice,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { type StoreSetter } from '@/store/types';
import type { BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { type AgentStore } from '../../store';
import {
  type BotProviderItem,
  botProvidersResource,
  PLATFORM_DEFINITIONS_KEY,
  platformDefinitionsResource,
} from './projection';

export type { BotProviderItem };

/** `useFetchBotProviders` / `useFetchPlatformDefinitions` result: replica flags plus the SWR-era aliases. */
export interface BotSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing cached to show for this entry yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

/** `botProvidersMap` is the view; the replica is its only writer. */
const botProvidersLens = recordLens<AgentStore, BotProviderItem[]>('botProvidersMap');

/**
 * The catalog is one value, not a keyed map, so it keeps its own flat field
 * (`botPlatformDefinitions`) as the replica view.
 */
const platformDefinitionsLens: ReplicaLens<AgentStore, SerializedPlatformDefinition[]> = {
  clear: () => ({ botPlatformDefinitions: undefined }),
  get: (state) => state.botPlatformDefinitions,
  keys: () => [PLATFORM_DEFINITIONS_KEY],
  set: (_state, _key, data) => ({ botPlatformDefinitions: data }),
};

/** The catalog fetch has no params; a stable empty object keeps the entry key constant. */
const PLATFORM_DEFINITIONS_PARAMS = {} as Record<string, never>;

type Setter = StoreSetter<AgentStore>;

export const createBotSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new BotSliceActionImpl(set, get, _api);

export class BotSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #platformDefinitions;
  readonly #providers;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#get = get;

    this.#providers = createReplicaSlice(botProvidersResource, {
      actionPrefix: 'botProviders',
      fetcher: async ({ agentId }) => agentBotProviderService.getByAgentId(agentId),
      get,
      set,
      stateKey: 'botProvidersReplica',
      view: botProvidersLens,
    });

    this.#platformDefinitions = createReplicaSlice(platformDefinitionsResource, {
      actionPrefix: 'botPlatformDefinitions',
      fetcher: () => agentBotProviderService.listPlatforms(),
      get,
      set,
      stateKey: 'botPlatformDefinitionsReplica',
      view: platformDefinitionsLens,
    });
  }

  createBotProvider = async (params: {
    agentId: string;
    applicationId: string;
    credentials: Record<string, string>;
    /** Defaults to enabled server-side; pass false to land an unusable draft. */
    enabled?: boolean;
    platform: string;
    settings?: Record<string, unknown>;
  }) => {
    const result = await agentBotProviderService.create(params);
    await this.internal_refreshBotProviders(params.agentId);
    return result;
  };

  connectBot = async (params: { agentId?: string; applicationId: string; platform: string }) => {
    const { agentId, ...runtimeParams } = params;
    const result = await agentBotProviderService.connectBot(runtimeParams);
    await this.internal_refreshBotProviders(agentId);
    return result;
  };

  testConnection = async (params: { applicationId: string; platform: string }) => {
    return agentBotProviderService.testConnection(params);
  };

  lineFetchBotInfo = async (channelAccessToken: string) => {
    return agentBotProviderService.lineFetchBotInfo(channelAccessToken);
  };

  feishuFetchOwnerId = async (params: {
    appId: string;
    appSecret: string;
    platform: 'feishu' | 'lark';
  }) => {
    return agentBotProviderService.feishuFetchOwnerId(params);
  };

  /**
   * Channel configs with their credentials in the clear, for an export file the
   * user can import elsewhere. The cached provider list is masked, so this has
   * to go back to the server rather than reuse it.
   */
  exportBotProviders = async (agentId: string) => {
    return agentBotProviderService.exportByAgentId(agentId);
  };

  deleteAllBotProviders = async (agentId: string) => {
    const providers = await agentBotProviderService.getByAgentId(agentId);
    await Promise.all(providers.map((p) => agentBotProviderService.delete(p.id)));
    await this.internal_refreshBotProviders(agentId);
  };

  deleteBotProvider = async (id: string, agentId: string) => {
    await agentBotProviderService.delete(id);
    await this.internal_refreshBotProviders(agentId);
  };

  refreshBotRuntimeStatus = async (params: {
    agentId?: string;
    applicationId: string;
    platform: string;
  }): Promise<BotRuntimeStatusSnapshot> => {
    const { agentId, ...rest } = params;
    const snapshot = await agentBotProviderService.refreshRuntimeStatus(rest);
    await this.internal_refreshBotProviders(agentId);
    return snapshot;
  };

  /**
   * Kick off a background refresh of every provider's live gateway status.
   * Fire-and-forget: the list can render from cached statuses immediately,
   * and we revalidate the replica once the server finishes updating Redis.
   */
  triggerRefreshAllBotStatuses = (agentId: string) => {
    agentBotProviderService
      .refreshRuntimeStatusesByAgent(agentId)
      .then(() => this.internal_refreshBotProviders(agentId))
      .catch(() => {
        // Non-critical: cached statuses remain visible.
      });
  };

  internal_refreshBotProviders = async (agentId?: string) => {
    const id = agentId || this.#get().activeAgentId;
    if (!id) return;
    await this.#providers.revalidate(id);
  };

  updateBotProvider = async (
    id: string,
    agentId: string,
    params: {
      applicationId?: string;
      credentials?: Record<string, string>;
      enabled?: boolean;
      settings?: Record<string, unknown>;
    },
  ) => {
    await agentBotProviderService.update(id, params);
    await this.internal_refreshBotProviders(agentId);
  };

  /** Fetch orchestration only; read the list through `botProvidersMap[agentId]`. */
  useFetchBotProviders = (agentId?: string): BotSyncResult => {
    const sync = this.#providers.useSync(agentId ? { agentId } : null, {
      revalidateOnFocus: false,
    });
    return {
      ...sync,
      isLoading: sync.isValidating && !(agentId && this.#get().botProvidersMap[agentId]),
      mutate: () => sync.revalidate(),
    };
  };

  /** Fetch orchestration only; read the catalog through `botPlatformDefinitions`. */
  useFetchPlatformDefinitions = (): BotSyncResult => {
    const sync = this.#platformDefinitions.useSync(PLATFORM_DEFINITIONS_PARAMS, {
      dedupingInterval: 300_000,
      revalidateOnFocus: false,
    });
    return {
      ...sync,
      isLoading: sync.isValidating && !this.#get().botPlatformDefinitions,
      mutate: () => sync.revalidate(),
    };
  };
}

export type BotSliceAction = Pick<BotSliceActionImpl, keyof BotSliceActionImpl>;
