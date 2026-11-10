import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { agentAccountService } from '@/services/agentAccount';

import { chunk, MAX_IDS_PER_WRITE, queueRowWrite } from './mailWrites';

/**
 * Undo of a trash, shared by the list and the reading pane: a restore of
 * exactly the ids the trash reported moving, never the selection, sent after
 * the trash itself has settled. A failure points at the trash, where the mail
 * can still be restored by hand.
 */
export const useRestoreTrashed = (onGoToTrash: () => void) => {
  const { t } = useTranslation('setting');

  return async (ids: string[], refresh: () => Promise<unknown>): Promise<boolean> => {
    try {
      await queueRowWrite(ids, () =>
        Promise.all(
          chunk(ids, MAX_IDS_PER_WRITE).map((batch) =>
            agentAccountService.restoreMail({ ids: batch }),
          ),
        ),
      );
      await refresh().catch(() => undefined);
      toast.success({ title: t('identity.mailbox.undone') });
      return true;
    } catch (error) {
      console.error('[AgentMail] undo failed', error);
      toast.error({
        actions: [{ label: t('identity.mailbox.goToTrash'), onClick: onGoToTrash }],
        title: t('identity.mailbox.failed.undo'),
      });
      return false;
    }
  };
};
