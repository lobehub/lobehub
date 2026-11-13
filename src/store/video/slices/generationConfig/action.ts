import { type AIVideoModelCard } from 'model-bank/aiModel';
import {
  extractVideoDefaultValues,
  type RuntimeVideoGenParams,
  type RuntimeVideoGenParamsKeys,
  type RuntimeVideoGenParamsValue,
  type VideoModelParamsSchema,
} from 'model-bank/standardParameters';

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
import {
  applyImageInputs,
  normalizeImageInputMode,
  pickImageInputs,
  type VideoImageInputMode,
  type VideoImageInputs,
} from './imageInputMode';

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

  const normalized = normalizeImageInputOnSchemaSwitch(previousParameters, nextSchema, result);
  const maxImageCount = nextSchema.imageUrls?.maxCount;

  if (Array.isArray(normalized.imageUrls) && typeof maxImageCount === 'number') {
    normalized.imageUrls = normalized.imageUrls.slice(0, maxImageCount);
  }

  return normalized;
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
    const { imageInputMode: previousMode, parameters: previousParameters } = this.#get();
    const { defaultValues, parametersSchema } = getVideoModelAndDefaults(model, provider);
    const { imageInputMode, parameters } = normalizeImageInputMode(
      preserveVideoInputParams(previousParameters, defaultValues, parametersSchema),
      parametersSchema,
      previousMode,
    );

    this.#set(
      {
        editingDraftSnapshot: undefined,
        editingGenerationId: undefined,
        imageInputMode,
        model,
        parameters,
        parametersSchema,
        provider,
        // Stashed images were sized for the previous model's slots
        stashedImageInputs: {},
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

  /**
   * Load a previous generation's model and settings, including its images. The image input mode
   * follows the images, so reference-mode settings reopen in reference mode.
   */
  reuseVideoSettings = (model: string, provider: string, config?: RuntimeVideoGenParams): void => {
    this.setModelAndProviderOnSelect(model, provider);
    if (!config) return;

    const { imageInputMode, parameters, parametersSchema } = this.#get();
    // The reused images replace the draft's instead of mixing with them
    const merged: Record<string, unknown> = { ...parameters };
    for (const key of ['imageUrl', 'imageUrls', 'endImageUrl']) {
      if (key in merged) merged[key] = key === 'imageUrls' ? [] : null;
    }
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) merged[key] = value;
    }

    this.#set(
      normalizeImageInputMode(merged as RuntimeVideoGenParams, parametersSchema, imageInputMode),
      false,
      `reuseVideoSettings/${model}/${provider}`,
    );
  };

  /**
   * Switch between start/end frames and references. The outgoing mode's images are stashed and
   * the incoming mode's stash restored, so only the active mode's images are submitted.
   */
  setImageInputMode = (mode: VideoImageInputMode): void => {
    const { imageInputMode, parameters, stashedImageInputs } = this.#get();
    if (mode === imageInputMode) return;

    this.#set(
      {
        imageInputMode: mode,
        parameters: applyImageInputs(parameters, mode, stashedImageInputs[mode]),
        stashedImageInputs: {
          ...stashedImageInputs,
          [imageInputMode]: pickImageInputs(parameters, imageInputMode),
          [mode]: undefined,
        },
      },
      false,
      `setImageInputMode/${mode}`,
    );
  };

  /**
   * Set one image input of `mode`. Uploads land here with the mode they started in: when the user
   * switched modes while they were in flight, the images join that mode's stash instead of the
   * submitted parameters, which would otherwise mix both modes and change the provider endpoint.
   */
  setImageInputForMode = <K extends keyof VideoImageInputs>(
    mode: VideoImageInputMode,
    key: K,
    value: VideoImageInputs[K],
  ): void => {
    const { imageInputMode, stashedImageInputs } = this.#get();
    if (mode === imageInputMode) {
      this.setParamOnInput(key, value as RuntimeVideoGenParamsValue);
      return;
    }

    this.#set(
      {
        stashedImageInputs: {
          ...stashedImageInputs,
          [mode]: { ...stashedImageInputs[mode], [key]: value },
        },
      },
      false,
      `setImageInputForMode/${mode}/${key}`,
    );
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

  addUploadingImagePreviews = (urls: string[]): void => {
    this.#set(
      (state) => ({ uploadingImagePreviews: [...state.uploadingImagePreviews, ...urls] }),
      false,
      'addUploadingImagePreviews',
    );
  };

  removeUploadingImagePreviews = (urls: string[]): void => {
    this.#set(
      (state) => ({
        uploadingImagePreviews: state.uploadingImagePreviews.filter((url) => !urls.includes(url)),
      }),
      false,
      'removeUploadingImagePreviews',
    );
  };
}

export type GenerationConfigAction = Pick<
  GenerationConfigActionImpl,
  keyof GenerationConfigActionImpl
>;
