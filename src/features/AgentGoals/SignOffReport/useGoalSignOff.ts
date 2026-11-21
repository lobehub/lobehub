import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';

export type SignOffPending = 'accept' | 'changes';

interface UseGoalSignOffOptions {
  acceptanceId: string;
  /** Runs once the decision landed, before `onDecided` re-reads the lists. */
  onClose: () => void;
  onDecided?: () => Promise<unknown> | void;
}

/**
 * Settle a goal's sign-off from its delivery report: accept it, or send it back
 * with the owner's feedback for the next round. A failure keeps the report open
 * and says so; a change request then keeps its draft (`requestChanges` → false).
 */
export const useGoalSignOff = ({ acceptanceId, onClose, onDecided }: UseGoalSignOffOptions) => {
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState<SignOffPending>();

  const settle = async (kind: SignOffPending, comment?: string): Promise<boolean> => {
    setPending(kind);
    try {
      if (kind === 'accept') await verifyService.acceptDelivery(acceptanceId, comment);
      else await verifyService.rejectDelivery(acceptanceId, comment, { dispatch: true });
    } catch (error) {
      console.error('[goal:sign-off-report]', error);
      toast.error(t('goalProcess.result.signOff.error'));
      return false;
    } finally {
      setPending(undefined);
    }
    toast.success({
      placement: 'top',
      title:
        kind === 'accept' ? t('goalProcess.signOff.accepted') : t('goalProcess.signOff.sentBack'),
    });
    onClose();
    await onDecided?.();
    return true;
  };

  return {
    accept: () => settle('accept'),
    pending,
    requestChanges: (comment: string) => settle('changes', comment),
  };
};
