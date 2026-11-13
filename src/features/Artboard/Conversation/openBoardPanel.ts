import { useGlobalStore } from '@/store/global';
import { artboardTabKey } from '@/store/global/initialState';

import { isArtboardEnabled } from '../useArtboardFeature';

export const openBoardPanel = (artboardId: string) => {
  if (!isArtboardEnabled()) return;
  useGlobalStore.getState().openWorkingSidebar(artboardTabKey(artboardId));
};
