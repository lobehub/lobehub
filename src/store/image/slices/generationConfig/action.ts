import {
  type AIImageModelCard,
  type ModelParamsSchema,
  type RuntimeImageGenParams,
  type RuntimeImageGenParamsKeys,
  type RuntimeImageGenParamsValue,
  extractDefaultValues,
} from 'model-bank';
import { type StateCreator } from 'zustand/vanilla';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

import type { ImageStore } from '../../store';
import { calculateInitialAspectRatio } from '../../utils/aspectRatio';
import { adaptSizeToRatio, parseRatio } from '../../utils/size';

export interface GenerationConfigAction {
  setParamOnInput<K extends RuntimeImageGenParamsKeys>(
    paramName: K,
    value: RuntimeImageGenParamsValue,
  ): void;

  setModelAndProviderOnSelect(model: string, provider: string): void;

  setImageNum: (imageNum: number) => void;

  reuseSettings: (
    model: string,
    provider: string,
    settings: Partial<RuntimeImageGenParams>,
  ) => void;
  reuseSeed: (seed: number) => void;

  setWidth(width: number): void;
  setHeight(height: number): void;
  toggleAspectRatioLock(): void;
  setAspectRatio(aspectRatio: string): void;

  // 初始化相关方法
  _initializeDefaultImageConfig(): void;
  initializeImageConfig(
    isLogin?: boolean,
    lastSelectedImageModel?: string,
    lastSelectedImageProvider?: string,
  ): void;
}

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

export const createGenerationConfigSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationConfigAction
> = (set, get) => ({
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

  setWidth: (width) => {
    set(
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
  },

  setHeight: (height) => {
    set(
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
  },

  toggleAspectRatioLock: () => {
    set(
      (state) => {
        const {
          isAspectRatioLocked,
          activeAspectRatio,
          parameters,
          parametersSchema: parametersSchema,
        } = state;
        const newLockState = !isAspectRatioLocked;

        // 如果是从解锁变为锁定，且有活动的宽高比，则立即调整尺寸
        if (newLockState && activeAspectRatio && parameters && parametersSchema) {
          const currentWidth = parameters.width;
          const currentHeight = parameters.height;

          // 只有当width和height都存在时才进行调整
          if (
            typeof currentWidth === 'number' &&
            typeof currentHeight === 'number' &&
            parametersSchema?.width &&
            parametersSchema?.height
          ) {
            const targetRatio = parseRatio(activeAspectRatio);
            const currentRatio = currentWidth / currentHeight;

            // 如果当前比例与目标比例不匹配，则需要调整
            if (Math.abs(currentRatio - targetRatio) > 0.01) {
              // 允许小误差
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
                // 优先保持宽度，调整高度
                let newWidth = currentWidth;
                let newHeight = Math.round(currentWidth / targetRatio);

                // 如果计算出的高度超出范围，则改为保持高度，调整宽度
                if (newHeight > heightSchema.max || newHeight < heightSchema.min) {
                  newHeight = currentHeight;
                  newWidth = Math.round(currentHeight * targetRatio);

                  // 确保宽度也在范围内
                  newWidth = Math.max(Math.min(newWidth, widthSchema.max), widthSchema.min);
                } else {
                  // 确保高度在范围内
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
  },

  setAspectRatio: (aspectRatio) => {
    const { parameters, parametersSchema: parametersSchema } = get();
    if (!parameters || !parametersSchema) return;

    const defaultValues = extractDefaultValues(parametersSchema);
    const newParams = { ...parameters };

    // 如果模型支持 width/height，则计算新尺寸
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

    // 如果模型本身支持 aspectRatio，则更新它
    if (parametersSchema?.aspectRatio) {
      newParams.aspectRatio = aspectRatio;
    }

    set(
      { activeAspectRatio: aspectRatio, parameters: newParams },
      false,
      `setAspectRatio/${aspectRatio}`,
    );
  },

  setModelAndProviderOnSelect: (model, provider) => {
    const { defaultValues, parametersSchema, initialActiveRatio } = prepareModelConfigState(
      model,
      provider,
    );

    set(
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

    // 仅在登录用户下记忆上次选择，保持与恢复策略一致
    const isLogin = authSelectors.isLogin(useUserStore.getState());
    if (isLogin) {
      useGlobalStore.getState().updateSystemStatus({
        lastSelectedImageModel: model,
        lastSelectedImageProvider: provider,
      });
    }
  },

  setImageNum: (imageNum) => {
    set(() => ({ imageNum }), false, `setImageNum/${imageNum}`);
  },

  reuseSettings: (model: string, provider: string, settings: Partial<RuntimeImageGenParams>) => {
    const { defaultValues, parametersSchema } = getModelAndDefaults(model, provider);
    set(
      () => ({
        model,
        provider,
        parameters: { ...defaultValues, ...settings },
        parametersSchema: parametersSchema,
      }),
      false,
      `reuseSettings/${model}/${provider}`,
    );
  },

  reuseSeed: (seed: number) => {
    set((state) => ({ parameters: { ...state.parameters, seed } }), false, `reuseSeed/${seed}`);
  },

  _initializeDefaultImageConfig: () => {
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());
    set({ imageNum: defaultImageNum, isInit: true }, false, 'initializeImageConfig/default');
  },

  initializeImageConfig: (isLogin, lastSelectedImageModel, lastSelectedImageProvider) => {
    const { _initializeDefaultImageConfig } = get();
    const { defaultImageNum } = settingsSelectors.currentImageSettings(useUserStore.getState());

    if (isLogin && lastSelectedImageModel && lastSelectedImageProvider) {
      try {
        const { defaultValues, parametersSchema, initialActiveRatio } = prepareModelConfigState(
          lastSelectedImageModel,
          lastSelectedImageProvider,
        );

        set(
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
  },
});
