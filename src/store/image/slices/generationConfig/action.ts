import {
  type AIImageModelCard,
  type ModelParamsSchema,
  type RuntimeImageGenParams,
  type RuntimeImageGenParamsKeys,
  type RuntimeImageGenParamsValue,
} from 'model-bank';
import { extractDefaultValues } from 'model-bank';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

import { type ImageStore } from '../../store';
import { calculateInitialAspectRatio } from '../../utils/aspectRatio';
import { adaptSizeToRatio, parseRatio } from '../../utils/size';

/**
 * @internal
 * This function is exported only for testing purposes.
 * Do not use this function directly in application code.
 */
export function getModelAndDefaults(model: string, provider: string) {
  const enabledImageModelList = aiProviderSelectors.enabledImageModelList(getAiInfraStoreState());

  const providerItem = enabledImageModelList.find((providerItem) => providerItem.id === provider);
  if (!providerItem) {
    throw new Error(
      `Provider "${provider}" not found in enabled image provider list. Available providers: ${enabledImageModelList.map((p) => p.id).join(', ')}`,
    );
  }

  const activeModel = providerItem.children.find(
    (modelItem) => modelItem.id === model,
  ) as unknown as AIImageModelCard;
  if (!activeModel) {
    throw new Error(
      `Model "${model}" not found in provider "${provider}". Available models: ${providerItem.children.map((m) => m.id).join(', ')}`,
    );
  }

  const parametersSchema = activeModel.parameters as ModelParamsSchema;
  const defaultValues = extractDefaultValues(parametersSchema);

  return { defaultValues, activeModel, parametersSchema };
}

/**
 * @internal Helper
 * Internal utility to derive initial config for a given provider/model.
 * Not exported; tests should cover through public actions.
 */
function prepareModelConfigState(model: string, provider: string) {
  const { defaultValues, parametersSchema } = getModelAndDefaults(model, provider);
  const initialActiveRatio = calculateInitialAspectRatio(parametersSchema, defaultValues);

  return {
    defaultValues,
    parametersSchema,
    initialActiveRatio,
  };
}

type Setter = StoreSetter<ImageStore>;
export const createGenerationConfigSlice = (set: Setter, get: () => ImageStore, _api?: unknown) =>
  new GenerationConfigActionImpl(set, get, _api);

export class GenerationConfigActionImpl {
  readonly #get: () => ImageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ImageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  setParamOnInput = <T extends RuntimeImageGenParamsKeys>(
    paramName: T,
    value: RuntimeImageGenParamsValue,
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

  setWidth = (width: number): void => {
    this.#set(
      (state) => {
        const {
          parameters,
          isAspectRatioLocked,
          activeAspectRatio,
          parametersSchema: parametersSchema,
        } = state;

        const newParams = { ...parameters, width };
        if (isAspectRatioLocked && activeAspectRatio) {
          const ratio = parseRatio(activeAspectRatio);
          const heightSchema = parametersSchema?.height;
          if (
            heightSchema &&
            typeof heightSchema.max === 'number' &&
            typeof heightSchema.min === 'number'
          ) {
            const newHeight = Math.round(width / ratio);
            newParams.height = Math.max(Math.min(newHeight, heightSchema.max), heightSchema.min);
          }
        }

        return { parameters: newParams };
      },
      false,
      `setWidth`,
    );
  };

  setHeight = (height: number): void => {
    this.#set(
      (state) => {
        const {
          parameters,
          isAspectRatioLocked,
          activeAspectRatio,
          parametersSchema: parametersSchema,
        } = state;
        const newParams = { ...parameters, height };

        if (isAspectRatioLocked && activeAspectRatio) {
          const ratio = parseRatio(activeAspectRatio);
          const widthSchema = parametersSchema?.width;
          if (
            widthSchema &&
            typeof widthSchema.max === 'number' &&
            typeof widthSchema.min === 'number'
          ) {
            const newWidth = Math.round(height * ratio);
            newParams.width = Math.max(Math.min(newWidth, widthSchema.max), widthSchema.min);
          }
        }

        return { parameters: newParams };
      },
      false,
      `setHeight`,
    );
  };

  toggleAspectRatioLock = (): void => {
    this.#set(
      (state) => {
        const {
          isAspectRatioLocked,
          activeAspectRatio,
          parameters,
          parametersSchema: parametersSchema,
        } = state;
        const newLockState = !isAspectRatioLocked;

        // If transitioning from unlocked to locked and there's an active aspect ratio, adjust dimensions immediately
        if (newLockState && activeAspectRatio && parameters && parametersSchema) {
          const currentWidth = parameters.width;
          const currentHeight = parameters.height;

          // Only adjust when both width and height exist
          if (
            typeof currentWidth === 'number' &&
            typeof currentHeight === 'number' &&
            parametersSchema?.width &&
            parametersSchema?.height
          ) {
            const targetRatio = parseRatio(activeAspectRatio);
            const currentRatio = currentWidth / currentHeight;

            // If current ratio doesn't match target ratio, adjustment is needed
            if (Math.abs(currentRatio - targetRatio) > 0.01) {
              // Allow small margin of error
              const widthSchema = parametersSchema.width;
              const heightSchema = parametersSchema.height;

              if (
                widthSchema &&
                heightSchema &&
                typeof widthSchema.max === 'number' &&
                typeof widthSchema.min === 'number' &&
                typeof heightSchema.max === 'number' &&
                typeof heightSchema.min === 'number'
              ) {
                // Prioritize keeping width, adjust height
                let newWidth = currentWidth;
                let newHeight = Math.round(currentWidth / targetRatio);

                // If calculated height is out of range, switch to keeping height and adjust width
                if (newHeight > heightSchema.max || newHeight < heightSchema.min) {
                  newHeight = currentHeight;
                  newWidth = Math.round(currentHeight * targetRatio);

                  // Ensure width is also within range
                  newWidth = Math.max(Math.min(newWidth, widthSchema.max), widthSchema.min);
                } else {
                  // Ensure height is within range
                  newHeight = Math.max(Math.min(newHeight, heightSchema.max), heightSchema.min);
                }

                return {
                  isAspectRatioLocked: newLockState,
                  parameters: { ...parameters, width: newWidth, height: newHeight },
                };
              }
            }
          }
        }

        return { isAspectRatioLocked: newLockState };
      },
      false,
      'toggleAspectRatioLock',
    );
  };

  setAspectRatio = (aspectRatio: string): void => {
    const { parameters, parametersSchema: parametersSchema } = this.#get();
    if (!parameters || !parametersSchema) return;

    const defaultValues = extractDefaultValues(parametersSchema);
    const newParams = { ...parameters };

    // If model supports width/height, calculate new dimensions
    if (
      parametersSchema?.width &&
      parametersSchema?.height &&
      typeof defaultValues.width === 'number' &&
      typeof defaultValues.height === 'number'
    ) {
      const ratio = parseRatio(aspectRatio);
      const { width, height } = adaptSizeToRatio(ratio, defaultValues.width, defaultValues.height);
      newParams.width = width;
      newParams.height = height;
    }

    // If model itself supports aspectRatio, update it
    if (parametersSchema?.aspectRatio) {
      newParams.aspectRatio = aspectRatio;
    }

    this.#set(
      { activeAspectRatio: aspectRatio, parameters: newParams },
      false,
      `setAspectRatio/${aspectRatio}`,
    );
  };

  setModelAndProviderOnSelect = (model: string, provider: string): void => {
    const { defaultValues, parametersSchema, initialActiveRatio } = prepareModelConfigState(
      model,
      provider,
    );

    this.#set(
      {
        model,
        provider,
        parameters: defaultValues,
        parametersSchema,
        isAspectRatioLocked: false,
        activeAspectRatio: initialActiveRatio,
      },
      false,
      `setModelAndProviderOnSelect/${model}/${provider}`,
    );

    // Only remember last selection for logged-in users, consistent with recovery strategy
    const isLogin = authSelectors.isLogin(useUserStore.getState());
    if (isLogin) {
      useGlobalStore.getState().updateSystemStatus({
        lastSelectedImageModel: model,
        lastSelectedImageProvider: provider,
      });
    }
  };

  setImageNum = (imageNum: number): void => {
    this.#set(() => ({ imageNum }), false, `setImageNum/${imageNum}`);
  };

  reuseSettings = (
    model: string,
    provider: string,
    settings: Partial<RuntimeImageGenParams>,
  ): void => {
    const { defaultValues, parametersSchema } = getModelAndDefaults(model, provider);
    this.#set(
      () => ({
        model,
        provider,
        parameters: { ...defaultValues, ...settings },
        parametersSchema: parametersSchema,
      }),
      false,
      `reuseSettings/${model}/${provider}`,
    );
  };

  reuseSeed = (seed: number): void => {
    this.#set(
      (state) => ({ parameters: { ...state.parameters, seed } }),
      false,
      `reuseSeed/${seed}`,
    );
  };

  _initializeDefaultImageConfig = (): void => {
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());
    this.#set({ imageNum: defaultImageNum, isInit: true }, false, 'initializeImageConfig/default');
  };

  initializeImageConfig = (
    isLogin?: boolean,
    lastSelectedImageModel?: string,
    lastSelectedImageProvider?: string,
  ): void => {
    const { _initializeDefaultImageConfig } = this.#get();
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());

    if (isLogin && lastSelectedImageModel && lastSelectedImageProvider) {
      try {
        const { defaultValues, parametersSchema, initialActiveRatio } = prepareModelConfigState(
          lastSelectedImageModel,
          lastSelectedImageProvider,
        );

        this.#set(
          {
            model: lastSelectedImageModel,
            provider: lastSelectedImageProvider,
            parameters: defaultValues,
            parametersSchema,
            isAspectRatioLocked: false,
            activeAspectRatio: initialActiveRatio,
            imageNum: defaultImageNum,
            isInit: true,
          },
          false,
          `initializeImageConfig/${lastSelectedImageModel}/${lastSelectedImageProvider}`,
        );
      } catch {
        _initializeDefaultImageConfig();
      }
    } else {
      _initializeDefaultImageConfig();
    }
  };
}

export type GenerationConfigAction = Pick<
  GenerationConfigActionImpl,
  keyof GenerationConfigActionImpl
>;
