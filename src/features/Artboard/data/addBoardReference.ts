import {
  type ArtboardReference,
  insertArtboardReference,
} from '@/features/ChatInput/InputEditor/ReferArtboard';

import { useArtboardStore } from '../store';

export const addBoardReference = (ref: ArtboardReference) =>
  !useArtboardStore.getState().gallery && insertArtboardReference(ref);
