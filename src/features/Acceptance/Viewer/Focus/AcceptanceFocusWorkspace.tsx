'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { openAddCheckModal } from '../Checks/AddCheckModal';
import { acceptanceCheckPath, acceptanceOverviewPath } from '../routes';
import { checksForTurn } from '../turnChecks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import { canReviewAcceptance } from '../visibility';
import AcceptanceFocusReview from './AcceptanceFocusReview';

const AcceptanceFocusWorkspace = () => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const query = searchParams.toString() ? `?${searchParams}` : '';
  const params = useParams<{ checkId?: string }>();
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const { turn } = useAcceptanceTurn();
  const turnChecks = data ? checksForTurn(data, turn) : [];
  const focusedCheck = turnChecks.find((check) => check.id === params.checkId);
  if (!data || !focusedCheck) return null;

  const orderedChecks = [...turnChecks].sort((a, b) => a.seq - b.seq);
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
      checks={turnChecks}
      focusedCheck={focusedCheck}
      orderedChecks={orderedChecks}
      reviewPending={false}
      roundCount={data.rounds.length}
      standingChecks={standing}
      status={data.acceptance.status}
      subjectTitle={data.subject.title ?? data.subject.id}
      canReview={
        canReviewAcceptance(data) && (turn === null || turn === data.rounds.at(-1)?.run.roundIndex)
      }
      // A phone opens this page by pushing onto the list, so the back arrow
      // pops that entry — replacing it would leave a duplicate overview behind
      // and make the system back button look broken.
      onBack={() =>
        (location.state as { fromCheckList?: boolean } | null)?.fromCheckList
          ? navigate(-1)
          : navigate(acceptanceOverviewPath(acceptanceId) + query, { replace: true })
      }
      // Stepping between checks replaces the entry in place, carrying the
      // "came from the list" flag so the back arrow still knows where to land.
      onSelectCheck={(id) =>
        navigate(acceptanceCheckPath(acceptanceId, id) + query, {
          replace: true,
          state: location.state,
        })
      }
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
