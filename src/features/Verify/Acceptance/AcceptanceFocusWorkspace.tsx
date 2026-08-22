'use client';

import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import AcceptanceFocusReview from './AcceptanceFocusReview';
import { useAcceptanceScope } from './AcceptanceScope';
import { openAddCheckModal } from './AddCheckModal';
import { type CheckFilter, checkFilterState } from './CheckList';
import { copyCheckRepairPrompt } from './checkWork';
import { acceptanceCheckPath, acceptanceOverviewPath } from './routes';
import { useAcceptanceBundle } from './useAcceptanceBundle';

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
    void globalMutate(verifyKeys.acceptances());
    toast.success(t('acceptance.checkCreate.saved'));
  };

  return (
    <AcceptanceFocusReview
      canReview={data.isOwner}
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
        data.isOwner && data.acceptance.status !== 'closed'
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
      onReview={async (input) => {
        await verifyService.reviewChecks({ id: data.acceptance.id, ...input });
        await mutate();
        void globalMutate(verifyKeys.acceptances());
        return true;
      }}
    />
  );
};

export default AcceptanceFocusWorkspace;
