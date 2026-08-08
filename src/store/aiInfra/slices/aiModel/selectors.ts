import type { ExtendParamsType } from 'model-bank';
import { MODEL_REASONING_EXTEND_PARAMS } from 'model-bank';
import { AiModelSourceEnum } from 'model-bank/aiModel';

import { type AIProviderStoreState } from '@/store/aiInfra/initialState';
import { ModelSearchImplement } from '@/types/search';

import { modelReasoningConfigKey } from './initialState';

const aiProviderChatModelListIds = (s: AIProviderStoreState) =>
  s.aiProviderModelList.filter((item) => item.type === 'chat').map((item) => item.id);
// List
const enabledAiProviderModelList = (s: AIProviderStoreState) =>
  s.aiProviderModelList.filter((item) => item.enabled);

const disabledAiProviderModelList = (s: AIProviderStoreState) =>
  s.aiProviderModelList.filter((item) => !item.enabled);

const filteredAiProviderModelList = (s: AIProviderStoreState) => {
  const keyword = s.modelSearchKeyword.toLowerCase().trim();

  return s.aiProviderModelList.filter(
    (model) =>
      model.id.toLowerCase().includes(keyword) ||
      model.displayName?.toLowerCase().includes(keyword),
  );
};

const totalAiProviderModelList = (s: AIProviderStoreState) => s.aiProviderModelList.length;

const isEmptyAiProviderModelList = (s: AIProviderStoreState) => totalAiProviderModelList(s) === 0;

const getModelCard = (model: string, provider: string) => (s: AIProviderStoreState) =>
  s.enabledAiModels?.find(
    (item) => item.id === model && (provider ? item.providerId === provider : true),
  ) || s.builtinAiModelList.find((item) => item.id === model && item.providerId === provider);

const hasRemoteModels = (s: AIProviderStoreState) =>
  s.aiProviderModelList.some((m) => m.source === AiModelSourceEnum.Remote);

const isModelEnabled = (id: string) => (s: AIProviderStoreState) =>
  enabledAiProviderModelList(s).some((i) => i.id === id);

const isModelLoading = (id: string) => (s: AIProviderStoreState) =>
  s.aiModelLoadingIds.includes(id);

const getAiModelById = (id: string) => (s: AIProviderStoreState) =>
  s.aiProviderModelList.find((i) => i.id === id);

const getEnabledModelById = (id: string, provider: string) => (s: AIProviderStoreState) =>
  s.enabledAiModels?.find((i) => i.id === id && (provider ? provider === i.providerId : true));

const isModelSupportToolUse = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.functionCall || false;
};

const isModelSupportFiles = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.files;
};

const isModelSupportVision = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.vision || false;
};

const isModelSupportVideo = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.video;
};

const isModelSupportAudio = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.audio || false;
};

const isModelSupportImageOutput = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.imageOutput || false;
};

const isModelSupportReasoning = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.abilities?.reasoning;
};

const isModelHasContextWindowToken =
  (id: string, provider: string) => (s: AIProviderStoreState) => {
    const model = getEnabledModelById(id, provider)(s);

    return typeof model?.contextWindowTokens === 'number';
  };

const modelContextWindowTokens = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.contextWindowTokens;
};

const modelExtendParams = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.settings?.extendParams;
};

const REASONING_EXTEND_PARAMS_SET = new Set<ExtendParamsType>(MODEL_REASONING_EXTEND_PARAMS);

/**
 * The subset of the model's extend params covered by the user-level
 * model-instance reasoning config (effort family + reasoningMode).
 */
const modelReasoningExtendParams = (id: string, provider: string) => (s: AIProviderStoreState) =>
  (modelExtendParams(id, provider)(s) ?? []).filter((param) =>
    REASONING_EXTEND_PARAMS_SET.has(param),
  );

const isModelHasReasoningExtendParams =
  (id: string, provider: string) => (s: AIProviderStoreState) =>
    modelReasoningExtendParams(id, provider)(s).length > 0;

/**
 * Whether the model exposes extend params beyond the reasoning family. The
 * reasoning family is edited through the ChatInput Effort control (user-level
 * model-instance config), so surfaces rendering a ControlsForm with
 * `hideReasoningParams` must gate on this instead of `isModelHasExtendParams`,
 * otherwise a reasoning-only model shows an empty popover.
 */
const isModelHasNonReasoningExtendParams =
  (id: string, provider: string) => (s: AIProviderStoreState) =>
    (modelExtendParams(id, provider)(s) ?? []).some(
      (param) => !REASONING_EXTEND_PARAMS_SET.has(param),
    );

/**
 * The user's saved per-model-instance reasoning defaults (personal scope).
 */
const modelReasoningConfig = (id: string, provider: string) => (s: AIProviderStoreState) =>
  s.modelReasoningConfigMap?.[modelReasoningConfigKey(provider, id)];

const isModelReasoningConfigUpdating =
  (id: string, provider: string) => (s: AIProviderStoreState) =>
    !!s.modelReasoningConfigUpdatingKeys?.includes(modelReasoningConfigKey(provider, id));

const modelDisabledParams = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.settings?.disabledParams;
};

const isModelHasExtendParams = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const controls = modelExtendParams(id, provider)(s);

  return !!controls && controls.length > 0;
};

const modelBuiltinSearchImpl = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const model = getEnabledModelById(id, provider)(s);

  return model?.settings?.searchImpl;
};

const isModelHasBuiltinSearch = (id: string, provider: string) => (s: AIProviderStoreState) => {
  const searchImpl = modelBuiltinSearchImpl(id, provider)(s);

  return !!searchImpl;
};

const isModelBuiltinSearchInternal =
  (id: string, provider: string) =>
  (s: AIProviderStoreState): boolean => {
    const searchImpl = modelBuiltinSearchImpl(id, provider)(s);

    return searchImpl === ModelSearchImplement.Internal;
  };

const isModelHasBuiltinSearchConfig =
  (id: string, provider: string) => (s: AIProviderStoreState) => {
    const searchImpl = modelBuiltinSearchImpl(id, provider)(s);

    return (
      !!searchImpl &&
      [ModelSearchImplement.Tool, ModelSearchImplement.Params].includes(
        searchImpl as ModelSearchImplement,
      )
    );
  };

export const aiModelSelectors = {
  aiProviderChatModelListIds,
  disabledAiProviderModelList,
  enabledAiProviderModelList,
  filteredAiProviderModelList,
  getAiModelById,
  getEnabledModelById,
  getModelCard,
  hasRemoteModels,
  isEmptyAiProviderModelList,
  isModelBuiltinSearchInternal,
  isModelEnabled,
  isModelHasBuiltinSearch,
  isModelHasBuiltinSearchConfig,
  isModelHasContextWindowToken,
  isModelHasExtendParams,
  isModelHasNonReasoningExtendParams,
  isModelHasReasoningExtendParams,
  isModelLoading,
  isModelReasoningConfigUpdating,
  isModelSupportAudio,
  isModelSupportFiles,
  isModelSupportImageOutput,
  isModelSupportReasoning,
  isModelSupportToolUse,
  isModelSupportVideo,
  isModelSupportVision,
  modelBuiltinSearchImpl,
  modelContextWindowTokens,
  modelDisabledParams,
  modelExtendParams,
  modelReasoningConfig,
  modelReasoningExtendParams,
  totalAiProviderModelList,
};
