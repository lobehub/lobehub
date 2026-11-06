import { useMemo } from 'react';

import { buildBoardModel } from '../model';
import { useArtboard } from './useArtboard';

export const useBoardModel = (artboardId: string) => {
  const { data } = useArtboard(artboardId);
  return useMemo(() => (data ? buildBoardModel(data.artboard, data.imageUrls) : undefined), [data]);
};
