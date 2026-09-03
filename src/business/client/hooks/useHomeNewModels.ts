export type HomeNewModelType = 'chat' | 'image' | 'video';

export interface HomeNewModelItem {
  iconModel?: string;
  /** Optional image URL rendered instead of the model icon mapping. */
  iconUrl?: string;
  model: string;
  provider?: string;
  title: string;
  type: HomeNewModelType;
}

export interface HomeNewModelsState {
  isLoading: boolean;
  items: HomeNewModelItem[];
}

export const useHomeNewModels = (fallbackItems: HomeNewModelItem[]): HomeNewModelsState => ({
  isLoading: false,
  items: fallbackItems,
});
