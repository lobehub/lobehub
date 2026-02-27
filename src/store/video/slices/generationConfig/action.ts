import {
  type AIVideoModelCard,
  extractVideoDefaultValues,
  type RuntimeVideoGenParamsKeys,
  type RuntimeVideoGenParamsValue,
  type VideoModelParamsSchema,
} from 'model-bank';
import { type StateCreator } from 'zustand/vanilla';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import type { VideoStore } from '../../store';

export interface GenerationConfigAction {
  initializeVideoConfig: (
    isLogin?: boolean,
    lastSelectedVideoModel?: string,
    lastSelectedVideoProvider?: string,
  ) => void;

  setModelAndProviderOnSelect: (model: string, provider: string) => void;

  setParamOnInput: <K extends RuntimeVideoGenParamsKeys>(
    paramName: K,
    value: RuntimeVideoGenParamsValue,
  ) => void;
}

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

export const createGenerationConfigSlice: StateCreator<
  VideoStore,
  [['zustand/devtools', never]],
  [],
  GenerationConfigAction
> = (set) => ({
  initializeVideoConfig: (isLogin, lastSelectedVideoModel, lastSelectedVideoProvider) => {
    if (isLogin && lastSelectedVideoModel && lastSelectedVideoProvider) {
      try {
        const { defaultValues, parametersSchema } = getVideoModelAndDefaults(
          lastSelectedVideoModel,
          lastSelectedVideoProvider,
        );

        set(
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
        set({ isInit: true }, false, 'initializeVideoConfig/default');
      }
    } else {
      set({ isInit: true }, false, 'initializeVideoConfig/default');
    }
  },

  setModelAndProviderOnSelect: (model, provider) => {
    const { defaultValues, parametersSchema } = getVideoModelAndDefaults(model, provider);

    set(
      {
        model,
        parameters: defaultValues,
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
  },

  setParamOnInput: (paramName, value) => {
    set(
      (state) => {
        const { parameters } = state;
        return { parameters: { ...parameters, [paramName]: value } };
      },
      false,
      `setParamOnInput/${paramName}`,
    );
  },
});
