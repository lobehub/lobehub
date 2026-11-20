import { LayersEnum } from '@/types/userMemory';

export const LAYER_LABEL_MAP: Record<LayersEnum, string> = {
  [LayersEnum.Activity]: 'activities',
  [LayersEnum.Context]: 'contexts',
  [LayersEnum.Experience]: 'experiences',
  [LayersEnum.Identity]: 'identities',
  [LayersEnum.Preference]: 'preferences',
};
