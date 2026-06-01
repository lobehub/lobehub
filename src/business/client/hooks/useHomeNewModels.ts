export type HomeNewModelType = 'chat' | 'image' | 'video';

export interface HomeNewModelItem {
  iconModel?: string;
  model: string;
  title: string;
  type: HomeNewModelType;
}

export const useHomeNewModels = (fallbackItems: HomeNewModelItem[]): HomeNewModelItem[] =>
  fallbackItems;
