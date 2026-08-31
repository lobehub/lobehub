'use client';

import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import AcceptanceFocusReview from './AcceptanceFocusReview';
import { useAcceptanceScope } from './AcceptanceScope';
import { openAddCheckModal } from './AddCheckModal';
import { type CheckFilter, checkFilterState } from './CheckList';
import { copyCheckRepairPrompt } from './checkWork';
import { acceptanceCheckPath, acceptanceOverviewPath } from './routes';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { canReviewAcceptance } from './visibility';

const CHECK_REVIEW_ORDER: Record<Exclude<CheckFilter, 'all'>, number> = {
  pending: 0,
  needsFix: 1,
  accepted: 2,
  ignored: 3,
};

const AcceptanceFocusWorkspace = () => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const params = useParams<{ checkId?: string }>();
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const focusedCheck = data?.checks.find((check) => check.id === params.checkId);
  if (!data || !focusedCheck) return null;

  const orderedChecks = [...data.checks].sort(
    (a, b) =>
      CHECK_REVIEW_ORDER[checkFilterState(a)] - CHECK_REVIEW_ORDER[checkFilterState(b)] ||
      a.seq - b.seq,
  );
  const standing = (data.acceptance.config?.checklist ?? []).filter(
    (item) => !data.checks.some((check) => check.id === item.id),
  );

  const saveStanding = async (checklist: typeof standing) => {
    await verifyService.saveAcceptanceChecklist(data.subject.type, data.subject.id, checklist);
    await mutate();
    void globalMutate(isAcceptanceListKey);
    toast.success(t('acceptance.checkCreate.saved'));
  };

  return (
    <AcceptanceFocusReview
      canReview={canReviewAcceptance(data)}
      checks={data.checks}
      focusedCheck={focusedCheck}
      orderedChecks={orderedChecks}
      reviewPending={false}
      roundCount={data.rounds.length}
      standingChecks={standing}
      status={data.acceptance.status}
      subjectTitle={data.subject.title ?? data.subject.id}
      onBack={() => navigate(acceptanceOverviewPath(acceptanceId), { replace: true })}
      onSelectCheck={(id) => navigate(acceptanceCheckPath(acceptanceId, id), { replace: true })}
      // Checklist authoring writes through the subject — creator-only until that
      // path is reviewer-aware. Reviewing the checks themselves is not.
      onAddChecks={
        data.isOwner
          ? () =>
              openAddCheckModal({
                existingIds: (data.acceptance.config?.checklist ?? []).map((item) => item.id),
                onSubmit: (items) =>
                  saveStanding([...(data.acceptance.config?.checklist ?? []), ...items]),
              })
          : undefined
      }
      onCheckWork={
        canReviewAcceptance(data) && data.acceptance.status !== 'closed'
          ? async () => {
              await copyCheckRepairPrompt(data.acceptance.id, focusedCheck, copyToClipboard);
              toast.success({ title: t('acceptance.checkWork.copied') });
            }
          : undefined
      }
      onEditStandingCheck={
        data.isOwner
          ? async (item) => {
              const { openCheckEditModal } =
                await import('@/features/Conversation/ChatInput/VerifyTray/EditModal');
              const checklist = data.acceptance.config?.checklist ?? [];
              openCheckEditModal({
                initial: { ...item, method: item.method ?? '' },
                onRemove: () =>
                  void saveStanding(checklist.filter((check) => check.id !== item.id)),
                onSubmit: (value) =>
                  saveStanding(
                    checklist.map((check) =>
                      check.id === item.id ? { ...check, ...value } : check,
                    ),
                  ),
              });
            }
          : undefined
      }
      // A rejected write must settle the row, not escape as an unhandled
      // rejection that leaves its button spinning with the reason in the console.
      onReview={async (input) => {
        try {
          await verifyService.reviewChecks({ id: data.acceptance.id, ...input });
          await mutate();
          void globalMutate(isAcceptanceListKey);
          return true;
        } catch (cause) {
          console.error('[acceptance:review]', cause);
          toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
          return false;
        }
      }}
    />
  );
};

export default AcceptanceFocusWorkspace;
