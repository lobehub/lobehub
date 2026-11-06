import type { ArtboardItem } from '@lobechat/types';
import { createContext, type ReactNode, use, useMemo } from 'react';

import { type BoardModel, buildBoardModel } from './model';

const BoardContext = createContext<BoardModel | null>(null);

interface BoardProviderProps {
  artboard: ArtboardItem;
  children: ReactNode;
  imageUrls: Record<string, string>;
}

export const BoardProvider = ({ artboard, children, imageUrls }: BoardProviderProps) => {
  const model = useMemo(() => buildBoardModel(artboard, imageUrls), [artboard, imageUrls]);
  return <BoardContext value={model}>{children}</BoardContext>;
};

export const useBoard = () => {
  const model = use(BoardContext);
  if (!model) throw new Error('useBoard must be used inside BoardProvider');
  return model;
};
