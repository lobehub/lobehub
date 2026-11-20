import { artboardActions } from '../store';
import { finalizeArtboard } from './actions';

interface FinalizeBoardParams {
  announce: (acceptanceId: string) => Promise<void>;
  artboardId: string;
  revision: number;
}

export const finalizeBoard = async ({ announce, artboardId, revision }: FinalizeBoardParams) => {
  const result = await finalizeArtboard(artboardId, revision);
  artboardActions.setMode('verify');
  if (result.acceptanceId)
    announce(result.acceptanceId).catch((error) => console.error('[artboard:announce]', error));
  return result;
};
