import {
  type ArtboardReference,
  insertArtboardReference,
} from '@/features/ChatInput/InputEditor/ReferArtboard';

import { useArtboardStore } from '../store';

export const addBoardReference = (ref: ArtboardReference) => {
  const { fullscreen, gallery } = useArtboardStore.getState();
  return !gallery && !fullscreen && insertArtboardReference(ref);
};
