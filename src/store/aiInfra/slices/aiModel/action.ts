import isEqual from 'fast-deep-equal';
import {
  AiModelSortMap,
  AiModelSourceEnum,
  AiProviderModelListItem,
  CreateAiModelParams,
  ToggleAiModelEnableParams,
} from 'model-bank';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { aiModelService } from '@/services/aiModel';
import { AiInfraStore } from '@/store/aiInfra/store';

import { ModelUpdateResult } from './types';

const FETCH_AI_PROVIDER_MODEL_LIST_KEY = 'FETCH_AI_PROVIDER_MODELS';

export interface AiModelAction {
  batchToggleAiModels: (ids: string[], enabled: boolean) => Promise<void>;
  batchUpdateAiModels: (models: AiProviderModelListItem[]) => Promise<void>;
  clearModelsByProvider: (provider: string) => Promise<void>;
  clearRemoteModels: (provider: string) => Promise<void>;
  createNewAiModel: (params: CreateAiModelParams) => Promise<void>;
  fetchRemoteModelList: (providerId: string) => Promise<ModelUpdateResult | undefined>;
  internal_toggleAiModelLoading: (id: string, loading: boolean) => void;

  refreshAiModelList: () => Promise<void>;
  removeAiModel: (id: string, providerId: string) => Promise<void>;
  toggleModelEnabled: (params: Omit<ToggleAiModelEnableParams, 'providerId'>) => Promise<void>;
  updateAiModelsConfig: (
    id: string,
    providerId: string,
    data: Partial<AiProviderModelListItem>,
  ) => Promise<void>;
  updateAiModelsSort: (providerId: string, items: AiModelSortMap[]) => Promise<void>;

  useFetchAiProviderModels: (id: string) => SWRResponse<AiProviderModelListItem[]>;
}

export const createAiModelSlice: StateCreator<
  AiInfraStore,
  [['zustand/devtools', never]],
  [],
  AiModelAction
> = (set, get) => ({
  batchToggleAiModels: async (ids, enabled) => {
    const { activeAiProvider } = get();
    if (!activeAiProvider) return;

    await aiModelService.batchToggleAiModels(activeAiProvider, ids, enabled);
    await get().refreshAiModelList();
  },
  batchUpdateAiModels: async (models) => {
    const { activeAiProvider: id } = get();
    if (!id) return;

    await aiModelService.batchUpdateAiModels(id, models);
    await get().refreshAiModelList();
  },
  clearModelsByProvider: async (provider) => {
    await aiModelService.clearModelsByProvider(provider);
    await get().refreshAiModelList();
  },
  clearRemoteModels: async (provider) => {
    await aiModelService.clearRemoteModels(provider);
    // Clear unavailableModelIds when clearing remote models
    set({ unavailableModelIds: [] }, false, `clearRemoteModels - ${provider}`);
    await get().refreshAiModelList();
  },
  createNewAiModel: async (data) => {
    await aiModelService.createAiModel(data);
    await get().refreshAiModelList();
  },
  fetchRemoteModelList: async (providerId) => {
    const { modelsService } = await import('@/services/models');

    // Get current models before fetching new ones
    const currentModels = get().aiProviderModelList;
    // Use all current model IDs for comparison, not just remote ones
    const currentModelIds = new Set(currentModels.map((m) => m.id));
    // Track only remote models for deletion logic
    const currentRemoteModelIds = new Set(
      currentModels.filter((m) => m.source === AiModelSourceEnum.Remote).map((m) => m.id),
    );

    const data = await modelsService.getModels(providerId);
    if (!data) return;

    const newRemoteModelIds = new Set(data.map((m) => m.id));

    // Calculate added models - models that don't exist in current list at all
    const added = data.filter((m) => !currentModelIds.has(m.id)).map((m) => m.id);

    // Calculate removed models (remote models that were in current list but not in new list)
    const removedModels = [...currentRemoteModelIds].filter((id) => !newRemoteModelIds.has(id));

    // Check which removed models exist in builtin model-bank
    let removedButBuiltin: string[] = [];
    let removedFromList: string[] = [];
    let builtinNotInRemote: string[] = [];

    // Get builtin models from model-bank
    let builtinModelIds = new Set<string>();
    try {
      // Dynamic import model-bank to check builtin models
      const modelBank = await import('model-bank');
      // @ts-expect-error providerId is dynamic
      const builtinModels = modelBank[providerId] as { id: string }[] | undefined;
      builtinModelIds = new Set(builtinModels?.map((m) => m.id) || []);

      // Check which builtin models are not in remote
      // For models with colon (e.g., "a:b"), check if base ID "a" exists in remote
      builtinNotInRemote = [...builtinModelIds].filter((id) => {
        // If the model ID exists directly in remote, it's available
        if (newRemoteModelIds.has(id)) return false;

        // If the model ID contains a colon, check if the base ID (before colon) exists in remote
        const colonIndex = id.indexOf(':');
        if (colonIndex !== -1) {
          const baseId = id.slice(0, colonIndex);
          // If base ID exists in remote, consider this model as available
          if (newRemoteModelIds.has(baseId)) return false;
        }

        // Model is not available in remote
        return true;
      });

      if (removedModels.length > 0) {
        removedModels.forEach((id) => {
          if (builtinModelIds.has(id)) {
            removedButBuiltin.push(id);
          } else {
            removedFromList.push(id);
          }
        });

        // Delete models that are not in builtin list
        if (removedFromList.length > 0) {
          await aiModelService.batchDeleteRemoteModels(providerId, removedFromList);
        }
      }
    } catch {
      // If model-bank import fails, treat all as removable
      removedFromList = removedModels;
      if (removedFromList.length > 0) {
        await aiModelService.batchDeleteRemoteModels(providerId, removedFromList);
      }
    }

    // Update models with new data
    await get().batchUpdateAiModels(
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

    await get().refreshAiModelList();

    // Update unavailable model IDs in store
    set({ unavailableModelIds: builtinNotInRemote }, false, 'fetchRemoteModelList/unavailable');

    // Only return result if there were changes or if this is not the first fetch
    const hasChanges =
      added.length > 0 ||
      removedFromList.length > 0 ||
      removedButBuiltin.length > 0 ||
      builtinNotInRemote.length > 0;
    const isFirstFetch = currentRemoteModelIds.size === 0;

    if (hasChanges || !isFirstFetch) {
      return {
        added,
        builtinNotInRemote,
        removedButBuiltin,
        removedFromList,
      };
    }
  },
  internal_toggleAiModelLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { aiModelLoadingIds: [...state.aiModelLoadingIds, id] };

        return { aiModelLoadingIds: state.aiModelLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiModelLoading',
    );
  },
  refreshAiModelList: async () => {
    await mutate([FETCH_AI_PROVIDER_MODEL_LIST_KEY, get().activeAiProvider]);
    // make refresh provide runtime state async, not block
    get().refreshAiProviderRuntimeState();
  },
  removeAiModel: async (id, providerId) => {
    await aiModelService.deleteAiModel({ id, providerId });
    await get().refreshAiModelList();
  },
  toggleModelEnabled: async (params) => {
    const { activeAiProvider } = get();
    if (!activeAiProvider) return;

    get().internal_toggleAiModelLoading(params.id, true);

    await aiModelService.toggleModelEnabled({ ...params, providerId: activeAiProvider });
    await get().refreshAiModelList();

    get().internal_toggleAiModelLoading(params.id, false);
  },

  updateAiModelsConfig: async (id, providerId, data) => {
    await aiModelService.updateAiModel(id, providerId, data);
    await get().refreshAiModelList();
  },
  updateAiModelsSort: async (id, items) => {
    await aiModelService.updateAiModelOrder(id, items);
    await get().refreshAiModelList();
  },

  useFetchAiProviderModels: (id) =>
    useClientDataSWR<AiProviderModelListItem[]>(
      [FETCH_AI_PROVIDER_MODEL_LIST_KEY, id],
      ([, id]) => aiModelService.getAiProviderModelList(id as string),
      {
        onSuccess: (data) => {
          // no need to update list if the list have been init and data is the same
          if (get().isAiModelListInit && isEqual(data, get().aiProviderModelList)) return;

          set(
            { aiProviderModelList: data, isAiModelListInit: true },
            false,
            `useFetchAiProviderModels/${id}`,
          );
        },
      },
    ),
});
