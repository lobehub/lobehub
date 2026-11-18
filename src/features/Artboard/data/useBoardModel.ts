import { useMemo } from 'react';

import { buildBoardModel } from '../model';
import { resolveArtboardFileBase } from './fileBase';
import { useArtboard } from './useArtboard';

export const useBoardModel = (artboardId: string) => {
  const { data } = useArtboard(artboardId);
  return useMemo(
    () =>
      data ? buildBoardModel(data.artboard, resolveArtboardFileBase(data.fileBaseUrl)) : undefined,
    [data],
  );
};
