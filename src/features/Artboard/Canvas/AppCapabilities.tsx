import { toast } from '@lobehub/ui';
import { type ReactNode, useMemo } from 'react';

import { useBoard } from '../BoardContext';
import { chooseOption } from '../data/actions';
import { boardFileUrl } from '../model';
import { useJourneyView } from '../Verify/useJourneyView';
import { type BoardCapabilities, BoardCapabilitiesProvider } from '../Viewport/capabilities';
import BoardFrame from './BoardFrame';

const AppBoardCapabilities = ({ children }: { children: ReactNode }) => {
  const board = useBoard();
  const journey = useJourneyView();
  const artboardId = board.artboard.id;
  const { fileBaseUrl } = board;
  const value = useMemo<BoardCapabilities>(
    () => ({
      journey,
      onPick: (roundId, boardId) =>
        void chooseOption(artboardId, roundId, boardId).catch((error) =>
          toast.error((error as Error).message),
        ),
      renderCanvas: (item) => {
        const src = boardFileUrl({ fileBaseUrl }, item);
        return src ? <BoardFrame src={src} title={item.title} /> : null;
      },
    }),
    [artboardId, fileBaseUrl, journey],
  );
  return <BoardCapabilitiesProvider value={value}>{children}</BoardCapabilitiesProvider>;
};

export default AppBoardCapabilities;
