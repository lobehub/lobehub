import { artboardService } from '@/services/artboard';

import { artboardActions, useArtboardStore } from '../store';
import { mutateArtboard } from './useArtboard';

export const checkArtboardRevision = async (id: string, shown: number) => {
  const latest = await artboardService.getRevision(id);
  if (useArtboardStore.getState().boardId !== id) return;
  artboardActions.setStaleRevision(latest > shown ? latest : null);
};

export const refreshStaleArtboard = async (id: string) => {
  await mutateArtboard(id);
  artboardActions.setStaleRevision(null);
};
