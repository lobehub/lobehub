import { type AIModelsState, initialAIModelState } from './slices/aiModel';
import { type AIProviderState, initialAIProviderState } from './slices/aiProvider';

export interface AIProviderStoreState extends AIProviderState, AIModelsState {
  /* empty */
}

export const initialState: AIProviderStoreState = {
  ...initialAIProviderState,
  ...initialAIModelState,
};
