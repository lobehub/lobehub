export type HomeNewModelType = 'chat' | 'image' | 'video';

export interface HomeNewModelItem {
  iconModel?: string;
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
