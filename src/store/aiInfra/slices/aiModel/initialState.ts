import {
  type AiModelReasoningConfig,
  type AiProviderModelListItem,
  type LobeDefaultAiModelListItem,
} from 'model-bank';

export interface AIModelsState {
  aiModelLoadingIds: string[];
  aiProviderModelList: AiProviderModelListItem[];
  builtinAiModelList: LobeDefaultAiModelListItem[];
  isAiModelListInit?: boolean;
  /**
   * The user's per-model-instance reasoning defaults, keyed by
   * `${providerId}/${modelId}` (personal scope, cross-workspace).
   */
  modelReasoningConfigMap: Record<string, AiModelReasoningConfig | undefined>;
  /**
   * `${providerId}/${modelId}` keys with an in-flight reasoning-config save.
   */
  modelReasoningConfigUpdatingKeys: string[];
  modelSearchKeyword: string;
}

export const initialAIModelState: AIModelsState = {
  aiModelLoadingIds: [],
  aiProviderModelList: [],
  builtinAiModelList: [],
  modelReasoningConfigMap: {},
  modelReasoningConfigUpdatingKeys: [],
  modelSearchKeyword: '',
};

export const modelReasoningConfigKey = (provider: string, model: string) => `${provider}/${model}`;
