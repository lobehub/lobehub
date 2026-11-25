import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { sendToBoardConversation } from '../data/boardConversation';
import { submitBoardBatch } from '../data/submitBatch';
import { mutateArtboard } from '../data/useArtboard';

export const useSubmitBatch = () => {
  const { t } = useTranslation('project');
  const board = useBoard();

  const notifyFailed = (message: string) =>
    toast.error({
      actions: [{ label: t('artboard.submit.resend'), onClick: () => void resend(message) }],
      title: t('artboard.submit.messageFailed'),
    });

  const resend = (message: string) =>
    sendToBoardConversation(board.artboard.topicId, message)
      .then((status) => status === 'messageFailed' && notifyFailed(message))
      .catch(() => notifyFailed(message));

  return async (roundIds: string[]) => {
    try {
      const { message, status } = await submitBoardBatch(board, roundIds);
      if (status === 'noConversation') toast.info(t('artboard.submit.noConversation'));
      if (status === 'messageFailed') notifyFailed(message);
    } catch (error) {
      void mutateArtboard(board.artboard.id);
      toast.error({ description: (error as Error).message, title: t('artboard.submit.failed') });
    }
  };
};
