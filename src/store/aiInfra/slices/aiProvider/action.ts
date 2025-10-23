import { isDeprecatedEdition, isDesktop, isUsePgliteDB } from '@lobechat/const';
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import { uniqBy } from 'lodash-es';
import {
  AIImageModelCard,
  EnabledAiModel,
  LobeDefaultAiModelListItem,
  ModelAbilities,
} from 'model-bank';
import { SWRResponse, mutate } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { aiProviderService } from '@/services/aiProvider';
import { AiInfraStore } from '@/store/aiInfra/store';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeState,
  AiProviderSortMap,
  AiProviderSourceEnum,
  CreateAiProviderParams,
  EnabledProvider,
  EnabledProviderWithModels,
  UpdateAiProviderConfigParams,
  UpdateAiProviderParams,
} from '@/types/aiProvider';

/**
 * Get models by provider ID and type, with proper formatting and deduplication
 */
export const getModelListByType = async (
  enabledAiModels: EnabledAiModel[],
  providerId: string,
  type: string,
) => {
  const filteredModels = enabledAiModels.filter(
    (model) => model.providerId === providerId && model.type === type,
  );

  const models = await Promise.all(
    filteredModels.map(async (model) => ({
      abilities: (model.abilities || {}) as ModelAbilities,
      contextWindowTokens: model.contextWindowTokens,
      displayName: model.displayName ?? '',
      id: model.id,
      ...(model.type === 'image' && {
        parameters:
          (model as AIImageModelCard).parameters ||
          (await getModelPropertyWithFallback(model.id, 'parameters')),
      }),
    })),
  );

  return uniqBy(models, 'id');
};

/**
 * Build provider model lists with proper async handling
 */
const buildProviderModelLists = async (
  providers: EnabledProvider[],
  enabledAiModels: EnabledAiModel[],
  type: 'chat' | 'image',
) => {
  return Promise.all(
    providers.map(async (provider) => ({
      ...provider,
      children: await getModelListByType(enabledAiModels, provider.id, type),
      name: provider.name || provider.id,
    })),
  );
};

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

          set({ activeAiProvider: id, aiProviderDetail: data }, false, 'useFetchAiProviderItem');
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
    const isAuthLoaded = authSelectors.isLoaded(useUserStore.getState());
    // Only fetch when auth is loaded and login status is explicitly defined (true or false)
    // Prevents unnecessary requests when login state is null/undefined
    const shouldFetch =
      isAuthLoaded && !isDeprecatedEdition && isLogin !== null && isLogin !== undefined;
    return useClientDataSWR<AiProviderRuntimeStateWithBuiltinModels | undefined>(
      shouldFetch ? [AiProviderSwrKey.fetchAiProviderRuntimeState, isLogin] : null,
      async ([, isLogin]) => {
        const [{ LOBE_DEFAULT_MODEL_LIST: builtinAiModelList }, { DEFAULT_MODEL_PROVIDER_LIST }] =
          await Promise.all([import('model-bank'), import('@/config/modelProviders')]);

        if (isLogin) {
          const data = await aiProviderService.getAiProviderRuntimeState();

          // Build model lists with proper async handling
          const [enabledChatModelList, enabledImageModelList] = await Promise.all([
            buildProviderModelLists(data.enabledChatAiProviders, data.enabledAiModels, 'chat'),
            buildProviderModelLists(data.enabledImageAiProviders, data.enabledAiModels, 'image'),
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
          buildProviderModelLists(enabledChatAiProviders, enabledAiModels, 'chat'),
          buildProviderModelLists(enabledImageAiProviders, enabledAiModels, 'image'),
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
        focusThrottleInterval: isDesktop || isUsePgliteDB ? 100 : undefined,
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
