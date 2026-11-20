import type { ArtboardItem } from '@lobechat/types';

import { artboardService } from '@/services/artboard';

import { artboardActions, useArtboardStore } from '../store';
import { mutateArtboard } from './useArtboard';

export const checkArtboardRevision = async (
  id: string,
  shown: Pick<ArtboardItem, 'revision' | 'updatedAt'>,
) => {
  const latest = await artboardService.getRevision(id);
  if (useArtboardStore.getState().boardId !== id) return;
  if (latest.revision > shown.revision) {
    artboardActions.setStaleRevision(latest.revision);
    return;
  }
  artboardActions.setStaleRevision(null);
  // Same structure, newer row: only files changed (a CLI push, another tab). Nothing on screen
  // can conflict with a file, so reload in place instead of asking.
  if (new Date(latest.updatedAt).getTime() > new Date(shown.updatedAt).getTime())
    await mutateArtboard(id);
};

export const refreshStaleArtboard = async (id: string) => {
  await mutateArtboard(id);
  artboardActions.setStaleRevision(null);
};
