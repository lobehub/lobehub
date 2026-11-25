import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';

import { useBoard } from '../BoardContext';
import { type FlowRun, nodeAttempts, nodeReview } from './flow';
import { useBoardAcceptance } from './useJourneyView';

export type CheckVerdict = 'accepted' | 'rejected';

type Attempt = NonNullable<FlowRun>['attempts'][number];

const reviewAttempts = (acceptanceId: string, attempts: Attempt[], verdict: CheckVerdict) =>
  Promise.all(
    attempts.map((attempt) =>
      verifyService.reviewFlowStep({
        attemptId: attempt.id,
        comment: '',
        id: acceptanceId,
        review: verdict,
      }),
    ),
  );

export const useCheckReview = (boardId: string) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { acceptanceId, journey, refresh } = useBoardAcceptance();
  const [saving, setSaving] = useState(false);
  const reviewable = nodeAttempts(journey, boardId).filter(
    (attempt) => attempt.verdict === 'passed' || attempt.verdict === 'failed',
  );

  const submit = async (verdict: CheckVerdict) => {
    if (!acceptanceId) return false;
    setSaving(true);
    try {
      await reviewAttempts(acceptanceId, reviewable, verdict);
      await refresh();
      toast.success(
        t(verdict === 'accepted' ? 'artboard.verify.accepted' : 'artboard.verify.rejected', {
          id: board.boardById[boardId]?.title ?? '',
        }),
      );
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    canReview: !!acceptanceId && reviewable.length > 0,
    review: nodeReview(journey, boardId),
    saving,
    submit,
  };
};

export const useAcceptAll = (boardIds: string[]) => {
  const { t } = useTranslation('project');
  const { acceptanceId, journey, refresh } = useBoardAcceptance();
  const [saving, setSaving] = useState(false);
  const pending = boardIds.filter((id) => {
    const attempts = nodeAttempts(journey, id);
    return attempts.length > 0 && attempts.every((a) => a.verdict === 'passed' && !a.review);
  });

  const acceptAll = async () => {
    if (!acceptanceId) return;
    setSaving(true);
    try {
      await reviewAttempts(
        acceptanceId,
        pending.flatMap((id) => nodeAttempts(journey, id)),
        'accepted',
      );
      await refresh();
      toast.success(t('artboard.verify.acceptedAll', { count: pending.length }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return { acceptAll, count: acceptanceId ? pending.length : 0, saving };
};
