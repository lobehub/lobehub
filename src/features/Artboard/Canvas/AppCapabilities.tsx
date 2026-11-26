import { toast } from '@lobehub/ui';
import { type ReactNode, useMemo } from 'react';

import { useBoard } from '../BoardContext';
import { chooseOption } from '../data/actions';
import { useAgentRunningInTopic } from '../data/agentRunning';
import { boardFileUrl } from '../model';
import { useJourneyView } from '../Verify/useJourneyView';
import { type BoardCapabilities, BoardCapabilitiesProvider } from '../Viewport/capabilities';
import BoardFrame from './BoardFrame';

const AppBoardCapabilities = ({ children }: { children: ReactNode }) => {
  const board = useBoard();
  const journey = useJourneyView();
  const artboardId = board.artboard.id;
  const { fileBaseUrl } = board;
  const agentRunning = useAgentRunningInTopic(board.artboard.topicId);
  const value = useMemo<BoardCapabilities>(
    () => ({
      agentRunning,
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
    [agentRunning, artboardId, fileBaseUrl, journey],
  );
  return <BoardCapabilitiesProvider value={value}>{children}</BoardCapabilitiesProvider>;
};

export default AppBoardCapabilities;
