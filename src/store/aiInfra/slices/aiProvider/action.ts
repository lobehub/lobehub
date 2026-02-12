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
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { aiProviderService } from '@/services/aiProvider';
import { type AiInfraStore } from '@/store/aiInfra/store';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import {
  type AiProviderDetailItem,
  type AiProviderListItem,
  type AiProviderRuntimeState,
  type AiProviderSortMap,
  type CreateAiProviderParams,
  type EnabledProvider,
  type EnabledProviderWithModels,
  type UpdateAiProviderConfigParams,
  type UpdateAiProviderParams,
} from '@/types/aiProvider';
import { AiProviderSourceEnum } from '@/types/aiProvider';

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

type Setter = StoreSetter<AiInfraStore>;
export const createAiProviderSlice = (set: Setter, get: () => AiInfraStore, _api?: unknown) =>
  new AiProviderActionImpl(set, get, _api);

export class AiProviderActionImpl {
  readonly #get: () => AiInfraStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AiInfraStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewAiProvider = async (params: CreateAiProviderParams): Promise<void> => {
    await aiProviderService.createAiProvider({ ...params, source: AiProviderSourceEnum.Custom });
    await this.#get().refreshAiProviderList();
  };

  deleteAiProvider = async (id: string): Promise<void> => {
    await aiProviderService.deleteAiProvider(id);

    await this.#get().refreshAiProviderList();
  };

  internal_toggleAiProviderConfigUpdating = (id: string, loading: boolean): void => {
    this.#set(
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
  };

  internal_toggleAiProviderLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { aiProviderLoadingIds: [...state.aiProviderLoadingIds, id] };

        return { aiProviderLoadingIds: state.aiProviderLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleAiProviderLoading',
    );
  };

  refreshAiProviderDetail = async (): Promise<void> => {
    await mutate([AiProviderSwrKey.fetchAiProviderItem, this.#get().activeAiProvider]);
    await this.#get().refreshAiProviderRuntimeState();
  };

  refreshAiProviderList = async (): Promise<void> => {
    await mutate(AiProviderSwrKey.fetchAiProviderList);
    await this.#get().refreshAiProviderRuntimeState();
  };

  refreshAiProviderRuntimeState = async (): Promise<void> => {
    await Promise.all([
      mutate([AiProviderSwrKey.fetchAiProviderRuntimeState, true]),
      mutate([AiProviderSwrKey.fetchAiProviderRuntimeState, false]),
    ]);
  };

  removeAiProvider = async (id: string): Promise<void> => {
    await aiProviderService.deleteAiProvider(id);
    await this.#get().refreshAiProviderList();
  };

  toggleProviderEnabled = async (id: string, enabled: boolean): Promise<void> => {
    this.#get().internal_toggleAiProviderLoading(id, true);
    await aiProviderService.toggleProviderEnabled(id, enabled);

    // Immediately update local aiProviderList to reflect the change
    // This ensures the switch displays correctly without waiting for SWR refresh
    this.#set(
      (state) => ({
        aiProviderList: state.aiProviderList.map((item) =>
          item.id === id ? { ...item, enabled } : item,
        ),
      }),
      false,
      'toggleProviderEnabled/syncEnabled',
    );

    await this.#get().refreshAiProviderList();

    this.#get().internal_toggleAiProviderLoading(id, false);
  };

  updateAiProvider = async (id: string, value: UpdateAiProviderParams): Promise<void> => {
    this.#get().internal_toggleAiProviderLoading(id, true);
    await aiProviderService.updateAiProvider(id, value);
    await this.#get().refreshAiProviderList();
    await this.#get().refreshAiProviderDetail();

    this.#get().internal_toggleAiProviderLoading(id, false);
  };

  updateAiProviderConfig = async (
    id: string,
    value: UpdateAiProviderConfigParams,
  ): Promise<void> => {
    this.#get().internal_toggleAiProviderConfigUpdating(id, true);
    await aiProviderService.updateAiProviderConfig(id, value);

    // Immediately update local state for instant UI feedback
    this.#set(
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

    await this.#get().refreshAiProviderDetail();

    this.#get().internal_toggleAiProviderConfigUpdating(id, false);
  };

  updateAiProviderSort = async (items: AiProviderSortMap[]): Promise<void> => {
    await aiProviderService.updateAiProviderOrder(items);
    await this.#get().refreshAiProviderList();
  };

  useFetchAiProviderItem = (id: string): SWRResponse<AiProviderDetailItem | undefined> => {
    return useClientDataSWR<AiProviderDetailItem | undefined>(
      [AiProviderSwrKey.fetchAiProviderItem, id],
      () => aiProviderService.getAiProviderById(id),
      {
        onSuccess: (data) => {
          if (!data) return;

          this.#set(
            (state) => ({
              activeAiProvider: id,
              aiProviderDetailMap: { ...state.aiProviderDetailMap, [id]: data },
            }),
            false,
            'useFetchAiProviderItem',
          );
        },
      },
    );
  };

  useFetchAiProviderList = (opts?: {
    enabled?: boolean;
    suspense?: boolean;
  }): SWRResponse<AiProviderListItem[]> => {
    return useClientDataSWR<AiProviderListItem[]>(
      opts?.enabled === false ? null : AiProviderSwrKey.fetchAiProviderList,
      () => aiProviderService.getAiProviderList(),
      {
        fallbackData: [],
        onSuccess: (data) => {
          if (!this.#get().initAiProviderList) {
            this.#set(
              { aiProviderList: data, initAiProviderList: true },
              false,
              'useFetchAiProviderList/init',
            );
            return;
          }

          this.#set({ aiProviderList: data }, false, 'useFetchAiProviderList/refresh');
        },
      },
    );
  };

  useFetchAiProviderRuntimeState = (
    isLoginOnInit: boolean | undefined,
    isSyncActive?: boolean,
  ): SWRResponse<AiProviderRuntimeStateWithBuiltinModels | undefined> => {
    void isSyncActive;
    const isLogin = isLoginOnInit;
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

          this.#set(
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
  };
}

export type AiProviderAction = Pick<AiProviderActionImpl, keyof AiProviderActionImpl>;
