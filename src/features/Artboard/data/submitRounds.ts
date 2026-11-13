import type { ArtboardItem, ArtboardRoundView } from '@lobechat/types';

import { artboardService } from '@/services/artboard';

import { sendToBoardConversation } from './boardConversation';
import { mutateArtboard } from './useArtboard';
import { mutateArtboardComments } from './useArtboardComments';

export interface RoundSummary {
  byRecommendation: number;
  firstUndecidedId: string | undefined;
  picked: number;
  total: number;
  undecided: number;
}

export const summarizeRounds = (open: ArtboardRoundView[]): RoundSummary => {
  const picked = open.filter((round) => round.chosenBoardId).length;
  const undecided = open.filter((round) => !round.chosenBoardId && !round.recommendedBoardId);
  return {
    byRecommendation: open.length - picked - undecided.length,
    firstUndecidedId: undecided[0]?.id,
    picked,
    total: open.length,
    undecided: undecided.length,
  };
};

export type SubmitStatus = 'messageFailed' | 'noConversation' | 'nothing' | 'sent';

export const submitBoardRounds = async (
  artboard: Pick<ArtboardItem, 'id' | 'topicId'>,
  roundIds: string[],
  messageOf: (count: number) => string,
): Promise<{ message: string; status: SubmitStatus }> => {
  const { submitted } = await artboardService.submitRounds(artboard.id, roundIds);
  void mutateArtboard(artboard.id);
  void mutateArtboardComments(artboard.id);
  const message = messageOf(submitted);
  if (!submitted) return { message, status: 'nothing' };

  try {
    return { message, status: await sendToBoardConversation(artboard.topicId, message) };
  } catch (error) {
    console.error('[artboard:submit]', error);
    return { message, status: 'messageFailed' };
  }
};
