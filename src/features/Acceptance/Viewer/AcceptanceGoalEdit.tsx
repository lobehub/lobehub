'use client';

import { ActionIcon } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const AcceptanceGoalEdit = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  if (!data?.isOwner) return null;

  const handleEdit = async () => {
    const { openGoalModal } =
      await import('@/features/Conversation/ChatInput/VerifyTray/GoalModal');
    openGoalModal({
      initialGoal: data.acceptance.requirement ?? undefined,
      onSubmit: async (goal) => {
        try {
          await verifyService.saveAcceptanceGoal(data.subject.type, data.subject.id, goal);
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
          throw cause;
        }
        await mutate();
        void globalMutate(verifyKeys.acceptances());
      },
    });
  };

  return (
    <ActionIcon
      icon={PencilLine}
      size={'small'}
      title={t('acceptance.goalEdit')}
      onClick={handleEdit}
    />
  );
};

export default AcceptanceGoalEdit;
