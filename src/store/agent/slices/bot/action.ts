import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentBotProviderService } from '@/services/agentBotProvider';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';

const FETCH_BOT_PROVIDERS_KEY = 'agentBotProviders';

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
  }) => {
    const result = await agentBotProviderService.create(params);
    await this.internal_refreshBotProviders(params.agentId);
    return result;
  };

  connectBot = async (params: { applicationId: string; platform: string }) => {
    return agentBotProviderService.connectBot(params);
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
}

export type BotSliceAction = Pick<BotSliceActionImpl, keyof BotSliceActionImpl>;
