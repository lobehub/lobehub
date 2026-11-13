import { useMemo } from 'react';

import { useAcceptanceBundle } from '@/features/Acceptance/Viewer/useAcceptanceBundle';

import { useBoard } from '../BoardContext';
import { acceptanceJourneyView } from './acceptanceView';
import { draftJourneyView } from './flow';

export const useBoardAcceptance = () => {
  const board = useBoard();
  const acceptanceId = board.finalized ? board.artboard.acceptanceId : null;
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const journey = useMemo(
    () => (data && acceptanceJourneyView(board, data)) || draftJourneyView(board),
    [board, data],
  );
  return { acceptanceId, journey, refresh: mutate };
};

export const useJourneyView = () => useBoardAcceptance().journey;
