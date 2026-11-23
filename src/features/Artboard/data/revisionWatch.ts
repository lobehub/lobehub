import type { ArtboardItem } from '@lobechat/types';

import { artboardService } from '@/services/artboard';

import { useArtboardStore } from '../store';
import { mutateArtboard } from './useArtboard';

export const checkArtboardRevision = async (
  id: string,
  shown: Pick<ArtboardItem, 'revision' | 'updatedAt'>,
) => {
  const latest = await artboardService.getRevision(id);
  if (useArtboardStore.getState().boardId !== id) return;
  const newerRevision = latest.revision > shown.revision;
  const newerFiles = new Date(latest.updatedAt).getTime() > new Date(shown.updatedAt).getTime();
  if (newerRevision || newerFiles) await mutateArtboard(id);
};
