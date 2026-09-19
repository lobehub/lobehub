import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentBotKeys } from '@/libs/swr/keys';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { type StoreSetter } from '@/store/types';
import type { BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { type AgentStore } from '../../store';

export interface BotProviderItem {
  applicationId: string;
  credentials: Record<string, string>;
  enabled: boolean;
  id: string;
  platform: string;
  settings?: Record<string, unknown> | null;
}

type Setter = StoreSetter<AgentStore>;

export const createBotSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new BotSliceActionImpl(set, get, _api);

export class BotSliceActionImpl {
  readonly #get: () => AgentStore;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
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
   * and we revalidate SWR once the server finishes updating Redis.
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
    await mutate(agentBotKeys.providers(id));
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

  useFetchBotProviders = (agentId?: string): SWRResponse<BotProviderItem[]> => {
    return useClientDataSWR<BotProviderItem[]>(
      agentId ? agentBotKeys.providers(agentId) : null,
      async ([, id]: [string, string]) => agentBotProviderService.getByAgentId(id),
      { fallbackData: [], revalidateOnFocus: false },
    );
  };

  useFetchPlatformDefinitions = (): SWRResponse<SerializedPlatformDefinition[]> => {
    return useClientDataSWR<SerializedPlatformDefinition[]>(
      agentBotKeys.platformDefinitions(),
      () => agentBotProviderService.listPlatforms(),
      { dedupingInterval: 300_000, fallbackData: [], revalidateOnFocus: false },
    );
  };
}

export type BotSliceAction = Pick<BotSliceActionImpl, keyof BotSliceActionImpl>;
