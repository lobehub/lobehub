import { toast } from '@lobehub/ui';
import { type ReactNode, useMemo } from 'react';

import CanvasFrame from '@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame';

import { useBoard } from '../BoardContext';
import { chooseOption } from '../data/actions';
import { useJourneyView } from '../Verify/useJourneyView';
import { type BoardCapabilities, BoardCapabilitiesProvider } from '../Viewport/capabilities';

const renderCanvas: BoardCapabilities['renderCanvas'] = ({ source }) =>
  source?.kind === 'canvas' ? (
    <CanvasFrame canvasId={source.canvasId} path={source.path} version={source.version} />
  ) : null;

const AppBoardCapabilities = ({ children }: { children: ReactNode }) => {
  const board = useBoard();
  const journey = useJourneyView();
  const artboardId = board.artboard.id;
  const value = useMemo<BoardCapabilities>(
    () => ({
      journey,
      onPick: (roundId, boardId) =>
        void chooseOption(artboardId, roundId, boardId).catch((error) =>
          toast.error((error as Error).message),
        ),
      renderCanvas,
    }),
    [artboardId, journey],
  );
  return <BoardCapabilitiesProvider value={value}>{children}</BoardCapabilitiesProvider>;
};

export default AppBoardCapabilities;
