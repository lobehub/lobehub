import {
  type ArtboardReference,
  insertArtboardReference,
} from '@/features/ChatInput/InputEditor/ReferArtboard';

import { artboardActions, useArtboardStore } from '../store';

export const addBoardReference = (ref: ArtboardReference) => {
  if (!useArtboardStore.getState().gallery) return insertArtboardReference(ref);
  artboardActions.addGalleryRef(ref);
  return true;
};
