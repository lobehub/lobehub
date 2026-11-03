import { type AIModelsState } from './slices/aiModel';
import { initialAIModelState } from './slices/aiModel';
import { type AIProviderState } from './slices/aiProvider';
import { initialAIProviderState } from './slices/aiProvider';

export interface AIProviderStoreState extends AIProviderState, AIModelsState {
  /* empty */
}

export const initialState: AIProviderStoreState = {
  ...initialAIProviderState,
  ...initialAIModelState,
};
