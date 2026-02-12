import isEqual from 'fast-deep-equal';
import {
  type AiModelSortMap,
  type AiProviderModelListItem,
  type CreateAiModelParams,
  type ToggleAiModelEnableParams,
} from 'model-bank';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { type AiInfraStore } from '@/store/aiInfra/store';
import { type StoreSetter } from '@/store/types';

const FETCH_AI_PROVIDER_MODEL_LIST_KEY = 'FETCH_AI_PROVIDER_MODELS';

type Setter = StoreSetter<AiInfraStore>;
export const createAiModelSlice = (set: Setter, get: () => AiInfraStore, _api?: unknown) =>
  new AiModelActionImpl(set, get, _api);

export class AiModelActionImpl {
  readonly #get: () => AiInfraStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AiInfraStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  batchToggleAiModels = async (ids: string[], enabled: boolean): Promise<void> => {
    const { activeAiProvider } = this.#get();
    if (!activeAiProvider) return;

    await aiModelService.batchToggleAiModels(activeAiProvider, ids, enabled);
    await this.#get().refreshAiModelList();
  };

  batchUpdateAiModels = async (models: AiProviderModelListItem[]): Promise<void> => {
    const { activeAiProvider: id } = this.#get();
    if (!id) return;

    await aiModelService.batchUpdateAiModels(id, models);
    await this.#get().refreshAiModelList();
  };

  clearModelsByProvider = async (provider: string): Promise<void> => {
    await aiModelService.clearModelsByProvider(provider);
    await this.#get().refreshAiModelList();
  };

  clearRemoteModels = async (provider: string): Promise<void> => {
    await aiModelService.clearRemoteModels(provider);
    await this.#get().refreshAiModelList();
  };

  createNewAiModel = async (data: CreateAiModelParams): Promise<void> => {
    await aiModelService.createAiModel(data);
    await this.#get().refreshAiModelList();
  };

  fetchRemoteModelList = async (providerId: string): Promise<void> => {
    const { modelsService } = await import('@/services/models');

    const data = await modelsService.getModels(providerId);
    if (data) {
      await this.#get().batchUpdateAiModels(
        data.map((model) => ({
          ...model,
          abilities: {
            files: model.files,
            functionCall: model.functionCall,
            imageOutput: model.imageOutput,
            reasoning: model.reasoning,
            search: model.search,
            video: model.video,
            vision: model.vision,
          },
          enabled: model.enabled || false,
          source: 'remote',
          type: model.type || 'chat',
        })),
      );

      await this.#get().refreshAiModelList();
    }
  };

  internal_toggleAiModelLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { aiModelLoadingIds: [...state.aiModelLoadingIds, id] };

        return { aiModelLoadingIds: state.aiModelLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiModelLoading',
    );
  };

  refreshAiModelList = async (): Promise<void> => {
    await mutate([FETCH_AI_PROVIDER_MODEL_LIST_KEY, this.#get().activeAiProvider]);
    // make refresh provide runtime state async, not block
    this.#get().refreshAiProviderRuntimeState();
  };

  removeAiModel = async (id: string, providerId: string): Promise<void> => {
    await aiModelService.deleteAiModel({ id, providerId });
    await this.#get().refreshAiModelList();
  };

  toggleModelEnabled = async (
    params: Omit<ToggleAiModelEnableParams, 'providerId'>,
  ): Promise<void> => {
    const { activeAiProvider } = this.#get();
    if (!activeAiProvider) return;

    this.#get().internal_toggleAiModelLoading(params.id, true);

    await aiModelService.toggleModelEnabled({ ...params, providerId: activeAiProvider });
    await this.#get().refreshAiModelList();

    this.#get().internal_toggleAiModelLoading(params.id, false);
  };

  updateAiModelsConfig = async (
    id: string,
    providerId: string,
    data: Partial<AiProviderModelListItem>,
  ): Promise<void> => {
    await aiModelService.updateAiModel(id, providerId, data);
    await this.#get().refreshAiModelList();
  };

  updateAiModelsSort = async (id: string, items: AiModelSortMap[]): Promise<void> => {
    await aiModelService.updateAiModelOrder(id, items);
    await this.#get().refreshAiModelList();
  };

  useFetchAiProviderModels = (id: string): SWRResponse<AiProviderModelListItem[]> => {
    return useClientDataSWR<AiProviderModelListItem[]>(
      [FETCH_AI_PROVIDER_MODEL_LIST_KEY, id],
      ([, id]) => aiModelService.getAiProviderModelList(id as string),
      {
        onSuccess: (data) => {
          // no need to update list if the list have been init and data is the same
          if (this.#get().isAiModelListInit && isEqual(data, this.#get().aiProviderModelList))
            return;

          this.#set(
            { aiProviderModelList: data, isAiModelListInit: true },
            false,
            `useFetchAiProviderModels/${id}`,
          );
        },
      },
    );
  };
}

export type AiModelAction = Pick<AiModelActionImpl, keyof AiModelActionImpl>;
