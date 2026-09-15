'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { openGroupFeedbackModal } from '../Review/modals';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { flowPlanPhase } from './planReview';

export function AcceptancePlanReview({ runId }: { runId: string | undefined }) {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [pending, setPending] = useState(false);
  const round = data?.rounds.find(({ run }) => run.id === runId);
  const phase = flowPlanPhase(round);
  if (!phase || !round || round.run.id !== data?.rounds.at(-1)?.run.id) return null;
  const canComment = data.canReview && !['accepted', 'closed'].includes(data.acceptance.status);

  const runAction = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await mutate();
      return true;
    } catch (error) {
      console.error('[acceptance:plan-review]', error);
      toast.error(t('flow.plan.actionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <Flexbox gap={12}>
      {canComment && (
        <Flexbox horizontal justify="flex-end">
          <Button
            disabled={pending}
            size="small"
            type="text"
            onClick={() =>
              openGroupFeedbackModal({
                title: t('flow.plan.requestChanges'),
                description: t('flow.plan.feedbackDescription'),
                groupLabel: t('flow.plan.label'),
                onConfirm: (comment, fileIds) =>
                  runAction(() =>
                    verifyService.addGroupFeedback({
                      id: acceptanceId,
                      category: 'flow-plan',
                      comment,
                      fileIds,
                    }),
                  ),
              })
            }
          >
            {t('flow.plan.requestChanges')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
