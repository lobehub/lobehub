import { AiProviderModelListItem, LobeDefaultAiModelListItem } from 'model-bank';

export interface AIModelsState {
  aiModelLoadingIds: string[];
  aiProviderModelList: AiProviderModelListItem[];
  builtinAiModelList: LobeDefaultAiModelListItem[];
  isAiModelListInit?: boolean;
  modelSearchKeyword: string;
  /** Model IDs that exist in model-bank but not available in remote provider */
  unavailableModelIds: string[];
}

export const initialAIModelState: AIModelsState = {
  aiModelLoadingIds: [],
  aiProviderModelList: [],
  builtinAiModelList: [],
  modelSearchKeyword: '',
  unavailableModelIds: [],
};
