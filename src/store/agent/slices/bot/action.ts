import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { type StoreSetter } from '@/store/types';

import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatusSnapshot,
} from '../../../../types/botRuntimeStatus';
import { type AgentStore } from '../../store';

const FETCH_BOT_PROVIDERS_KEY = 'agentBotProviders';
const FETCH_PLATFORM_DEFINITIONS_KEY = 'platformDefinitions';
const FETCH_BOT_RUNTIME_STATUSES_KEY = 'agentBotRuntimeStatuses';

export interface BotProviderItem {
  applicationId: string;
  credentials: Record<string, string>;
  enabled: boolean;
  id: string;
  platform: string;
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
    platform: string;
    settings?: Record<string, unknown>;
  }) => {
    const result = await agentBotProviderService.create(params);
    await this.internal_refreshBotProviders(params.agentId);
    await this.internal_refreshBotRuntimeStatuses(params.agentId);
    return result;
  };

  connectBot = async (params: { agentId?: string; applicationId: string; platform: string }) => {
    const { agentId, ...runtimeParams } = params;
    const result = await agentBotProviderService.connectBot(runtimeParams);
    await this.internal_refreshBotRuntimeStatuses(agentId);
    return result;
  };

  testConnection = async (params: { applicationId: string; platform: string }) => {
    return agentBotProviderService.testConnection(params);
  };

  deleteBotProvider = async (id: string, agentId: string) => {
    await agentBotProviderService.delete(id);
    await this.internal_refreshBotProviders(agentId);
    await this.internal_refreshBotRuntimeStatuses(agentId);
  };

  internal_refreshBotProviders = async (agentId?: string) => {
    const id = agentId || this.#get().activeAgentId;
    if (!id) return;
    await mutate([FETCH_BOT_PROVIDERS_KEY, id]);
  };

  internal_refreshBotRuntimeStatuses = async (agentId?: string) => {
    const id = agentId || this.#get().activeAgentId;
    if (!id) return;
    await mutate([FETCH_BOT_RUNTIME_STATUSES_KEY, id]);
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
    await this.internal_refreshBotRuntimeStatuses(agentId);
  };

  useFetchBotProviders = (agentId?: string): SWRResponse<BotProviderItem[]> => {
    return useClientDataSWR<BotProviderItem[]>(
      agentId ? [FETCH_BOT_PROVIDERS_KEY, agentId] : null,
      async ([, id]: [string, string]) => agentBotProviderService.getByAgentId(id),
      { fallbackData: [], revalidateOnFocus: false },
    );
  };

  useFetchBotRuntimeStatuses = (agentId?: string): SWRResponse<BotRuntimeStatusSnapshot[]> => {
    return useClientDataSWR<BotRuntimeStatusSnapshot[]>(
      agentId ? [FETCH_BOT_RUNTIME_STATUSES_KEY, agentId] : null,
      async ([, id]: [string, string]) => agentBotProviderService.listRuntimeStatuses(id),
      {
        fallbackData: [],
        refreshInterval: (data?: BotRuntimeStatusSnapshot[]) => {
          const hasPendingRuntime =
            data?.some(
              (item) =>
                item.status === BOT_RUNTIME_STATUSES.queued ||
                item.status === BOT_RUNTIME_STATUSES.starting,
            ) ?? false;
          return hasPendingRuntime ? 2000 : 0;
        },
        revalidateOnFocus: false,
      },
    );
  };

  useFetchPlatformDefinitions = (): SWRResponse<SerializedPlatformDefinition[]> => {
    return useClientDataSWR<SerializedPlatformDefinition[]>(
      FETCH_PLATFORM_DEFINITIONS_KEY,
      () => agentBotProviderService.listPlatforms(),
      { dedupingInterval: 300_000, fallbackData: [], revalidateOnFocus: false },
    );
  };
}

export type BotSliceAction = Pick<BotSliceActionImpl, keyof BotSliceActionImpl>;
