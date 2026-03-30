import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';

const FETCH_BOT_PROVIDERS_KEY = 'agentBotProviders';
const FETCH_PLATFORM_DEFINITIONS_KEY = 'platformDefinitions';

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

  deleteAllBotProviders = async (agentId: string) => {
    const providers = await agentBotProviderService.getByAgentId(agentId);
    await Promise.all(providers.map((p) => agentBotProviderService.delete(p.id)));
    await this.internal_refreshBotProviders(agentId);
  };

  deleteBotProvider = async (id: string, agentId: string) => {
    await agentBotProviderService.delete(id);
    await this.internal_refreshBotProviders(agentId);
  };

  internal_refreshBotProviders = async (agentId?: string) => {
    const id = agentId || this.#get().activeAgentId;
    if (!id) return;
    await mutate([FETCH_BOT_PROVIDERS_KEY, id]);
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
      agentId ? [FETCH_BOT_PROVIDERS_KEY, agentId] : null,
      async ([, id]: [string, string]) => agentBotProviderService.getByAgentId(id),
      { fallbackData: [], revalidateOnFocus: false },
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
