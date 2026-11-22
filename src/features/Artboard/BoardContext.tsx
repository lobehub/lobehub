import type { ArtboardItem } from '@lobechat/types';
import { createContext, type ReactNode, use, useMemo } from 'react';

import { type BoardModel, buildBoardModel } from './model';
import { useArtboardStore } from './store';

const BoardContext = createContext<BoardModel | null>(null);

interface BoardProviderProps {
  artboard: ArtboardItem;
  children: ReactNode;
  fileBaseUrl: string | null;
}

export const BoardProvider = ({ artboard, children, fileBaseUrl }: BoardProviderProps) => {
  const pageId = useArtboardStore((s) => s.pageId);
  const model = useMemo(
    () => buildBoardModel(artboard, fileBaseUrl, pageId),
    [artboard, fileBaseUrl, pageId],
  );
  return <BoardContext value={model}>{children}</BoardContext>;
};

export const useBoard = () => {
  const model = use(BoardContext);
  if (!model) throw new Error('useBoard must be used inside BoardProvider');
  return model;
};
