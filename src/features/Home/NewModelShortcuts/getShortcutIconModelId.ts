import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

export const getShortcutIconModelId = (item: Pick<HomeNewModelItem, 'iconModel' | 'model'>) =>
  item.iconModel ?? item.model;
