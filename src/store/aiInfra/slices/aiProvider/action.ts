import { getModelPropertyWithFallback, resolveImageSinglePrice } from '@lobechat/model-runtime';
import { uniqBy } from 'es-toolkit/compat';
import {
  type AIImageModelCard,
  type EnabledAiModel,
  type LobeDefaultAiModelListItem,
  type ModelAbilities,
  type ModelParamsSchema,
  type Pricing,
} from 'model-bank';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { aiProviderService } from '@/services/aiProvider';
import { type AiInfraStore } from '@/store/aiInfra/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import {
  type AiProviderDetailItem,
  type AiProviderListItem,
  type AiProviderRuntimeState,
  type AiProviderSortMap,
  AiProviderSourceEnum,
  type CreateAiProviderParams,
  type EnabledProvider,
  type EnabledProviderWithModels,
  type UpdateAiProviderConfigParams,
  type UpdateAiProviderParams,
} from '@/types/aiProvider';

export type ProviderModelListItem = {
  abilities: ModelAbilities;
  approximatePricePerImage?: number;
  contextWindowTokens?: number;
  description?: string;
  displayName: string;
  id: string;
  parameters?: ModelParamsSchema;
  pricePerImage?: number;
  pricing?: Pricing;
  releasedAt?: string;
};

type ModelNormalizer = (model: EnabledAiModel) => Promise<ProviderModelListItem>;

const dedupeById = (models: ProviderModelListItem[]) => uniqBy(models, 'id');

const createProviderModelCollector = (
  type: EnabledAiModel['type'],
  normalizer: ModelNormalizer,
) => {
  return async (enabledAiModels: EnabledAiModel[], providerId: string) => {
    const filteredModels = enabledAiModels.filter(
      (model) => model.providerId === providerId && model.type === type,
    );

    if (!filteredModels.length) return [];

    const normalized = await Promise.all(filteredModels.map((model) => normalizer(model)));
    return dedupeById(normalized);
  };
};

export const normalizeChatModel = (model: EnabledAiModel): ProviderModelListItem => ({
  abilities: (model.abilities || {}) as ModelAbilities,
  contextWindowTokens: model.contextWindowTokens,
  displayName: model.displayName ?? '',
  id: model.id,
  releasedAt: model.releasedAt,
});

export const normalizeImageModel = async (
  model: EnabledAiModel,
): Promise<ProviderModelListItem> => {
  const fallbackParametersPromise = model.parameters
    ? Promise.resolve<ModelParamsSchema | undefined>(model.parameters)
    : getModelPropertyWithFallback<ModelParamsSchema | undefined>(
        model.id,
        'parameters',
        model.providerId,
      );

  const modelWithPricing = model as AIImageModelCard;
  const fallbackPricingPromise = modelWithPricing.pricing
    ? Promise.resolve<Pricing | undefined>(modelWithPricing.pricing)
    : getModelPropertyWithFallback<Pricing | undefined>(model.id, 'pricing', model.providerId);

  const fallbackDescriptionPromise = getModelPropertyWithFallback<string | undefined>(
    model.id,
    'description',
    model.providerId,
  );

  const [fallbackParameters, fallbackPricing, fallbackDescription] = await Promise.all([
    fallbackParametersPromise,
    fallbackPricingPromise,
    fallbackDescriptionPromise,
  ]);

  const parameters = model.parameters ?? fallbackParameters;
  const pricing = fallbackPricing;
  const description = fallbackDescription;
  const { price, approximatePrice } = resolveImageSinglePrice(pricing);

  return {
    abilities: (model.abilities || {}) as ModelAbilities,
    contextWindowTokens: model.contextWindowTokens,
    displayName: model.displayName ?? '',
    id: model.id,
    releasedAt: model.releasedAt,
    ...(parameters && { parameters }),
    ...(description && { description }),
    ...(pricing && { pricing }),
    ...(typeof approximatePrice === 'number' && { approximatePricePerImage: approximatePrice }),
    ...(typeof price === 'number' && { pricePerImage: price }),
  };
};

export const getChatModelList = createProviderModelCollector('chat', async (model) =>
  normalizeChatModel(model),
);

export const getImageModelList = createProviderModelCollector('image', normalizeImageModel);

const buildProviderModelLists = async (
  providers: EnabledProvider[],
  enabledAiModels: EnabledAiModel[],
  collector: (
    enabledAiModels: EnabledAiModel[],
    providerId: string,
  ) => Promise<ProviderModelListItem[]>,
) => {
  return Promise.all(
    providers.map(async (provider) => ({
      ...provider,
      children: await collector(enabledAiModels, provider.id),
      name: provider.name || provider.id,
    })),
  );
};

/**
 * Build image provider model lists with proper async handling
 */
const buildImageProviderModelLists = async (
  providers: EnabledProvider[],
  enabledAiModels: EnabledAiModel[],
) => buildProviderModelLists(providers, enabledAiModels, getImageModelList);

/**
 * Build chat provider model lists with proper async handling
 */
const buildChatProviderModelLists = async (
  providers: EnabledProvider[],
  enabledAiModels: EnabledAiModel[],
) => buildProviderModelLists(providers, enabledAiModels, getChatModelList);

enum AiProviderSwrKey {
  fetchAiProviderItem = 'FETCH_AI_PROVIDER_ITEM',
  fetchAiProviderList = 'FETCH_AI_PROVIDER',
  fetchAiProviderRuntimeState = 'FETCH_AI_PROVIDER_RUNTIME_STATE',
}

type AiProviderRuntimeStateWithBuiltinModels = AiProviderRuntimeState & {
  builtinAiModelList: LobeDefaultAiModelListItem[];
  enabledChatModelList?: EnabledProviderWithModels[];
  enabledImageModelList?: EnabledProviderWithModels[];
};

export interface AiProviderAction {
  createNewAiProvider: (params: CreateAiProviderParams) => Promise<void>;
  deleteAiProvider: (id: string) => Promise<void>;
  internal_toggleAiProviderConfigUpdating: (id: string, loading: boolean) => void;
  internal_toggleAiProviderLoading: (id: string, loading: boolean) => void;
  refreshAiProviderDetail: () => Promise<void>;
  refreshAiProviderList: () => Promise<void>;
  refreshAiProviderRuntimeState: () => Promise<void>;
  removeAiProvider: (id: string) => Promise<void>;
  toggleProviderEnabled: (id: string, enabled: boolean) => Promise<void>;
  updateAiProvider: (id: string, value: UpdateAiProviderParams) => Promise<void>;
  updateAiProviderConfig: (id: string, value: UpdateAiProviderConfigParams) => Promise<void>;
  updateAiProviderSort: (items: AiProviderSortMap[]) => Promise<void>;

  useFetchAiProviderItem: (id: string) => SWRResponse<AiProviderDetailItem | undefined>;
  useFetchAiProviderList: (params?: {
    enabled?: boolean;
    suspense?: boolean;
  }) => SWRResponse<AiProviderListItem[]>;
  /**
   * fetch provider keyVaults and user enabled model list
   * @param isLoginOnInit
   */
  useFetchAiProviderRuntimeState: (
    isLoginOnInit: boolean | undefined,
    isSyncActive?: boolean,
  ) => SWRResponse<AiProviderRuntimeStateWithBuiltinModels | undefined>;
}

export const createAiProviderSlice: StateCreator<
  AiInfraStore,
  [['zustand/devtools', never]],
  [],
  AiProviderAction
> = (set, get) => ({
  createNewAiProvider: async (params) => {
    await aiProviderService.createAiProvider({ ...params, source: AiProviderSourceEnum.Custom });
    await get().refreshAiProviderList();
  },
  deleteAiProvider: async (id: string) => {
    await aiProviderService.deleteAiProvider(id);

    await get().refreshAiProviderList();
  },
  internal_toggleAiProviderConfigUpdating: (id, loading) => {
    set(
      (state) => {
        if (loading)
          return { aiProviderConfigUpdatingIds: [...state.aiProviderConfigUpdatingIds, id] };

        return {
          aiProviderConfigUpdatingIds: state.aiProviderConfigUpdatingIds.filter((i) => i !== id),
        };
      },
      false,
      'toggleAiProviderLoading',
    );
  },
  internal_toggleAiProviderLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { aiProviderLoadingIds: [...state.aiProviderLoadingIds, id] };

        return { aiProviderLoadingIds: state.aiProviderLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiProviderLoading',
    );
  },
  refreshAiProviderDetail: async () => {
    await mutate([AiProviderSwrKey.fetchAiProviderItem, get().activeAiProvider]);
    await get().refreshAiProviderRuntimeState();
  },
  refreshAiProviderList: async () => {
    await mutate(AiProviderSwrKey.fetchAiProviderList);
    await get().refreshAiProviderRuntimeState();
  },
  refreshAiProviderRuntimeState: async () => {
    await Promise.all([
      mutate([AiProviderSwrKey.fetchAiProviderRuntimeState, true]),
      mutate([AiProviderSwrKey.fetchAiProviderRuntimeState, false]),
    ]);
  },
  removeAiProvider: async (id) => {
    await aiProviderService.deleteAiProvider(id);
    await get().refreshAiProviderList();
  },

  toggleProviderEnabled: async (id: string, enabled: boolean) => {
    get().internal_toggleAiProviderLoading(id, true);
    await aiProviderService.toggleProviderEnabled(id, enabled);

    // Immediately update local aiProviderList to reflect the change
    // This ensures the switch displays correctly without waiting for SWR refresh
    set(
      (state) => ({
        aiProviderList: state.aiProviderList.map((item) =>
          item.id === id ? { ...item, enabled } : item,
        ),
      }),
      false,
      'toggleProviderEnabled/syncEnabled',
    );

    await get().refreshAiProviderList();

    get().internal_toggleAiProviderLoading(id, false);
  },

  updateAiProvider: async (id, value) => {
    get().internal_toggleAiProviderLoading(id, true);
    await aiProviderService.updateAiProvider(id, value);
    await get().refreshAiProviderList();
    await get().refreshAiProviderDetail();

    get().internal_toggleAiProviderLoading(id, false);
  },

  updateAiProviderConfig: async (id, value) => {
    get().internal_toggleAiProviderConfigUpdating(id, true);
    await aiProviderService.updateAiProviderConfig(id, value);

    // Immediately update local state for instant UI feedback
    set(
      (state) => {
        const currentRuntimeConfig = state.aiProviderRuntimeConfig[id];
        const currentDetailConfig = state.aiProviderDetailMap[id];

        const updates: Partial<typeof currentRuntimeConfig> = {};
        const detailUpdates: Partial<typeof currentDetailConfig> = {};

        // Update fetchOnClient if changed
        if (typeof value.fetchOnClient !== 'undefined') {
          // Convert null to undefined to match the interface definition
          const fetchOnClientValue = value.fetchOnClient === null ? undefined : value.fetchOnClient;
          updates.fetchOnClient = fetchOnClientValue;
          detailUpdates.fetchOnClient = fetchOnClientValue;
        }

        // Update config.enableResponseApi if changed
        if (value.config?.enableResponseApi !== undefined && currentRuntimeConfig?.config) {
          updates.config = {
            ...currentRuntimeConfig.config,
            enableResponseApi: value.config.enableResponseApi,
          };
        }

        return {
          // Update detail map for form display
          aiProviderDetailMap:
            currentDetailConfig && Object.keys(detailUpdates).length > 0
              ? {
                  ...state.aiProviderDetailMap,
                  [id]: {
                    ...currentDetailConfig,
                    ...detailUpdates,
                  },
                }
              : state.aiProviderDetailMap,
          // Update runtime config for selectors
          aiProviderRuntimeConfig:
            currentRuntimeConfig && Object.keys(updates).length > 0
              ? {
                  ...state.aiProviderRuntimeConfig,
                  [id]: {
                    ...currentRuntimeConfig,
                    ...updates,
                  },
                }
              : state.aiProviderRuntimeConfig,
        };
      },
      false,
      'updateAiProviderConfig/syncChanges',
    );

    await get().refreshAiProviderDetail();

    get().internal_toggleAiProviderConfigUpdating(id, false);
  },

  updateAiProviderSort: async (items) => {
    await aiProviderService.updateAiProviderOrder(items);
    await get().refreshAiProviderList();
  },
  useFetchAiProviderItem: (id) =>
    useClientDataSWR<AiProviderDetailItem | undefined>(
      [AiProviderSwrKey.fetchAiProviderItem, id],
      () => aiProviderService.getAiProviderById(id),
      {
        onSuccess: (data) => {
          if (!data) return;

          set(
            (state) => ({
              activeAiProvider: id,
              aiProviderDetailMap: { ...state.aiProviderDetailMap, [id]: data },
            }),
            false,
            'useFetchAiProviderItem',
          );
        },
      },
    ),
  useFetchAiProviderList: (opts) =>
    useClientDataSWR<AiProviderListItem[]>(
      opts?.enabled === false ? null : AiProviderSwrKey.fetchAiProviderList,
      () => aiProviderService.getAiProviderList(),
      {
        fallbackData: [],
        onSuccess: (data) => {
          if (!get().initAiProviderList) {
            set(
              { aiProviderList: data, initAiProviderList: true },
              false,
              'useFetchAiProviderList/init',
            );
            return;
          }

          set({ aiProviderList: data }, false, 'useFetchAiProviderList/refresh');
        },
      },
    ),

  useFetchAiProviderRuntimeState: (isLogin) => {
    const isAuthLoaded = useUserStore(authSelectors.isLoaded);
    // Only fetch when auth is loaded and login status is explicitly defined (true or false)
    // Prevents unnecessary requests when login state is null/undefined
    const shouldFetch = isAuthLoaded && isLogin !== null && isLogin !== undefined;

    return useClientDataSWR<AiProviderRuntimeStateWithBuiltinModels | undefined>(
      shouldFetch ? [AiProviderSwrKey.fetchAiProviderRuntimeState, isLogin] : null,
      async ([, isLogin]) => {
        const [{ LOBE_DEFAULT_MODEL_LIST: builtinAiModelList }, { DEFAULT_MODEL_PROVIDER_LIST }] =
          await Promise.all([import('model-bank'), import('model-bank/modelProviders')]);

        if (isLogin) {
          const data = await aiProviderService.getAiProviderRuntimeState();
          // Build model lists with proper async handling
          const [enabledChatModelList, enabledImageModelList] = await Promise.all([
            buildChatProviderModelLists(data.enabledChatAiProviders, data.enabledAiModels),
            buildImageProviderModelLists(data.enabledImageAiProviders, data.enabledAiModels),
          ]);

          return {
            ...data,
            builtinAiModelList,
            enabledChatModelList,
            enabledImageModelList,
          };
        }

        const enabledAiProviders: EnabledProvider[] = DEFAULT_MODEL_PROVIDER_LIST.filter(
          (provider) => provider.enabled,
        ).map((item) => ({ id: item.id, name: item.name, source: AiProviderSourceEnum.Builtin }));

        const enabledChatAiProviders = enabledAiProviders.filter((provider) => {
          return builtinAiModelList.some(
            (model) => model.providerId === provider.id && model.type === 'chat',
          );
        });

        const enabledImageAiProviders = enabledAiProviders
          .filter((provider) => {
            return builtinAiModelList.some(
              (model) => model.providerId === provider.id && model.type === 'image',
            );
          })
          .map((item) => ({ id: item.id, name: item.name, source: AiProviderSourceEnum.Builtin }));

        // Build model lists for non-login state as well
        const enabledAiModels = builtinAiModelList.filter((m) => m.enabled);
        const [enabledChatModelList, enabledImageModelList] = await Promise.all([
          buildChatProviderModelLists(enabledChatAiProviders, enabledAiModels),
          buildImageProviderModelLists(enabledImageAiProviders, enabledAiModels),
        ]);

        return {
          builtinAiModelList,
          enabledAiModels,
          enabledAiProviders,
          enabledChatAiProviders,
          enabledChatModelList,
          enabledImageAiProviders,
          enabledImageModelList,
          runtimeConfig: {},
        };
      },
      {
        onSuccess: (data) => {
          if (!data) return;

          set(
            {
              aiProviderRuntimeConfig: data.runtimeConfig,
              builtinAiModelList: data.builtinAiModelList,
              enabledAiModels: data.enabledAiModels,
              enabledAiProviders: data.enabledAiProviders,
              enabledChatModelList: data.enabledChatModelList || [],
              enabledImageModelList: data.enabledImageModelList || [],
              isInitAiProviderRuntimeState: true,
            },
            false,
            'useFetchAiProviderRuntimeState',
          );
        },
      },
    );
  },
});
