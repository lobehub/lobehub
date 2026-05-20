import {
  type AIVideoModelCard,
  extractVideoDefaultValues,
  type RuntimeVideoGenParams,
  type RuntimeVideoGenParamsKeys,
  type RuntimeVideoGenParamsValue,
  type VideoModelParamsSchema,
} from 'model-bank';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import {
  normalizeImageInputOnSchemaSwitch,
  preserveSupportedParams,
} from '../../../utils/preserveSupportedParams';
import type { VideoStore } from '../../store';

export function getVideoModelAndDefaults(model: string, provider: string) {
  const enabledVideoModelList = aiProviderSelectors.enabledVideoModelList(getAiInfraStoreState());

  const providerItem = enabledVideoModelList.find((providerItem) => providerItem.id === provider);
  if (!providerItem) {
    throw new Error(
      `Provider "${provider}" not found in enabled video provider list. Available providers: ${enabledVideoModelList.map((p) => p.id).join(', ')}`,
    );
  }

  const activeModel = providerItem.children.find(
    (modelItem) => modelItem.id === model,
  ) as unknown as AIVideoModelCard;
  if (!activeModel) {
    throw new Error(
      `Model "${model}" not found in provider "${provider}". Available models: ${providerItem.children.map((m) => m.id).join(', ')}`,
    );
  }

  const parametersSchema = activeModel.parameters as VideoModelParamsSchema;
  const defaultValues = extractVideoDefaultValues(parametersSchema);

  return { activeModel, defaultValues, parametersSchema };
}

function preserveVideoInputParams(
  previousParameters: RuntimeVideoGenParams,
  nextDefaultValues: RuntimeVideoGenParams,
  nextSchema: VideoModelParamsSchema,
) {
  const result = preserveSupportedParams(previousParameters, nextDefaultValues, nextSchema, [
    'prompt',
    'imageUrl',
    'imageUrls',
    'endImageUrl',
  ]);

  return normalizeImageInputOnSchemaSwitch(previousParameters, nextSchema, result);
}

type Setter = StoreSetter<VideoStore>;

export const createGenerationConfigSlice = (set: Setter, get: () => VideoStore, _api?: unknown) =>
  new GenerationConfigActionImpl(set, get, _api);

export class GenerationConfigActionImpl {
  readonly #get: () => VideoStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => VideoStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
  }

  initializeVideoConfig = (
    isLogin?: boolean,
    lastSelectedVideoModel?: string,
    lastSelectedVideoProvider?: string,
  ): void => {
    if (isLogin && lastSelectedVideoModel && lastSelectedVideoProvider) {
      try {
        const { defaultValues, parametersSchema } = getVideoModelAndDefaults(
          lastSelectedVideoModel,
          lastSelectedVideoProvider,
        );

        this.#set(
          {
            isInit: true,
            model: lastSelectedVideoModel,
            parameters: defaultValues,
            parametersSchema,
            provider: lastSelectedVideoProvider,
          },
          false,
          `initializeVideoConfig/${lastSelectedVideoModel}/${lastSelectedVideoProvider}`,
        );
      } catch {
        this.#set({ isInit: true }, false, 'initializeVideoConfig/default');
      }
    } else {
      this.#set({ isInit: true }, false, 'initializeVideoConfig/default');
    }
  };

  setModelAndProviderOnSelect = (model: string, provider: string): void => {
    const previousParameters = this.#get().parameters;
    const { defaultValues, parametersSchema } = getVideoModelAndDefaults(model, provider);
    const parameters = preserveVideoInputParams(
      previousParameters,
      defaultValues,
      parametersSchema,
    );

    this.#set(
      {
        model,
        parameters,
        parametersSchema,
        provider,
      },
      false,
      `setModelAndProviderOnSelect/${model}/${provider}`,
    );

    const isLogin = authSelectors.isLogin(useUserStore.getState());
    if (isLogin) {
      useGlobalStore.getState().updateSystemStatus({
        lastSelectedVideoModel: model,
        lastSelectedVideoProvider: provider,
      });
    }
  };

  setParamOnInput = <K extends RuntimeVideoGenParamsKeys>(
    paramName: K,
    value: RuntimeVideoGenParamsValue,
  ): void => {
    this.#set(
      (state) => {
        const { parameters } = state;
        return { parameters: { ...parameters, [paramName]: value } };
      },
      false,
      `setParamOnInput/${paramName}`,
    );
  };
}

export type GenerationConfigAction = Pick<
  GenerationConfigActionImpl,
  keyof GenerationConfigActionImpl
>;
