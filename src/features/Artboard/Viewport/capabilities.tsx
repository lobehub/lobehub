import type { ArtboardBoardView } from '@lobechat/types';
import { createContext, type ReactNode, use } from 'react';

import type { JourneyView } from '../Verify/flow';

export interface BoardCapabilities {
  journey?: JourneyView;
  onPick?: (roundId: string, boardId: string) => void;
  renderCanvas: (board: ArtboardBoardView) => ReactNode;
}

const BoardCapabilitiesContext = createContext<BoardCapabilities | null>(null);

export const BoardCapabilitiesProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: BoardCapabilities;
}) => <BoardCapabilitiesContext value={value}>{children}</BoardCapabilitiesContext>;

export const useBoardCapabilities = () => {
  const capabilities = use(BoardCapabilitiesContext);
  if (!capabilities)
    throw new Error('useBoardCapabilities must be used inside BoardCapabilitiesProvider');
  return capabilities;
};
