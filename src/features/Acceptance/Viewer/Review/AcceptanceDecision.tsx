'use client';

import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useIsHydrated } from '@/hooks/useIsHydrated';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { checkFilterState, isException } from '../Checks/checkState';
import { buildRepairPrompt } from '../Checks/checkWork';
import { useAcceptanceComments } from '../Comments/hooks';
import { flowPlanPhase } from '../Plan/planReview';
import { acceptanceCheckPath } from '../routes';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useAcceptanceTurn } from '../useAcceptanceTurn';
import { formatAcceptanceCountsText, LIVE_ACCEPTANCE_STATUSES } from '../verdict';
import { canReviewAcceptance } from '../visibility';
import DecisionBar from './DecisionBar';
import FeedbackDrawer, { type FeedbackListEntry } from './FeedbackDrawer';
import { openAcceptModal, openGroupFeedbackModal, openRejectModal } from './modals';

interface AcceptanceDecisionProps {
  onDraftToComposer?: (text: string) => boolean;
}

const AcceptanceDecision = ({ onDraftToComposer }: AcceptanceDecisionProps) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const hydrated = useIsHydrated();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const { turn, setTurn } = useAcceptanceTurn(embedded);
  const [pending, setPending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { approvals } = useAcceptanceComments(acceptanceId);
  if (!data || !canReviewAcceptance(data) || data.acceptance.status === 'closed') return null;

  if (flowPlanPhase(data.rounds.at(-1))) return null;

  if (turn !== null && turn !== data.rounds.at(-1)?.run.roundIndex)
    return (
      <Flexbox gap={8}>
        <Text type={'secondary'}>{t('acceptance.review.historicalReadOnly')}</Text>
        <Button style={{ minHeight: 44 }} onClick={() => setTurn(null)}>
          {t('acceptance.filter.roundAll')}
        </Button>
      </Flexbox>
    );
  const { acceptance, checks, rounds } = data;
  const currentRound = rounds.at(-1);
  const acceptedCount = checks.filter((check) => checkFilterState(check) === 'accepted').length;
  const needsFixCount = checks.filter((check) => checkFilterState(check) === 'needsFix').length;
  const ignoredCount = checks.filter((check) => checkFilterState(check) === 'ignored').length;
  const reviewTotal = checks.length;
  const pendingCount = reviewTotal - acceptedCount - needsFixCount - ignoredCount;
  const decidedCount = acceptedCount + needsFixCount + ignoredCount;
  const countsText = formatAcceptanceCountsText(t, {
    failed: checks.filter((check) => check.state === 'failed').length,
    notExecuted: checks.filter((check) => check.state === 'not_executed').length,
    passed: checks.filter((check) => check.state === 'passed').length,
    uncertain: checks.filter((check) => check.state === 'uncertain').length,
  });
  const barState = LIVE_ACCEPTANCE_STATUSES.has(acceptance.status)
    ? ('live' as const)
    : acceptance.status === 'accepted'
      ? ('accepted' as const)
      : acceptance.status === 'rejected'
        ? ('rejected' as const)
        : ('settled' as const);
  const barTexts = {
    accepted: {
      statusText: t('acceptance.banner.accepted', {
        time:
          hydrated && acceptance.completedAt
            ? dayjs(acceptance.completedAt).format('YYYY-MM-DD HH:mm')
            : '',
      }),
      subText: `${countsText} · ${t('acceptance.banner.acceptedHint', { count: rounds.length })}`,
    },
    live: {
      statusText: t(`acceptance.status.${acceptance.status}`),
      subText: t('acceptance.banner.liveHint'),
    },
    rejected: {
      statusText: t('acceptance.banner.rejected'),
      subText: currentRound?.run.decisionDetail?.comment ?? t('acceptance.banner.rejectedHint'),
    },
    settled:
      decidedCount === 0
        ? {
            statusText: t('acceptance.bar.progressZero', { total: reviewTotal }),
            subText: undefined,
          }
        : pendingCount === 0
          ? needsFixCount === 0
            ? {
                statusText: t('acceptance.bar.progressDone', { total: reviewTotal }),
                subText: undefined,
              }
            : {
                statusText: t('acceptance.bar.needsFix', { count: needsFixCount }),
                subText: undefined,
              }
          : {
              statusText: t('acceptance.bar.progress', {
                done: decidedCount,
                rest: pendingCount,
                total: reviewTotal,
              }),
              subText: undefined,
            },
  }[barState];

  // Teammates' approvals ride along the state line: they are opinions the
  // decider reads, never the decision itself. Only this round's count — an
  // approval given to round 1 says nothing about round 2, and the reviewer's
  // own card already asks them to look again, so counting it here would tell
  // the decider the opposite of what the reviewer is being shown.
  const approvalText = (() => {
    const roundIndex = currentRound?.run.roundIndex;
    if (roundIndex === undefined) return undefined;
    const count = approvals.filter((approval) => approval.contextRoundIndex === roundIndex).length;
    return count > 0 ? t('acceptance.comments.approvalCount', { count }) : undefined;
  })();
  const subTextWithApprovals = [barTexts.subText, approvalText].filter(Boolean).join(' · ');

  const currentRoundIndex = currentRound?.run.roundIndex ?? 0;
  const groupFeedbackEntries = rounds.flatMap((round) =>
    (round.run.decisionDetail?.groupFeedback ?? []).map((entry) => ({
      ...entry,
      roundIndex: round.run.roundIndex ?? 0,
    })),
  );
  const feedbackEntries: FeedbackListEntry[] = [
    ...checks.flatMap((check) =>
      check.reviews
        .filter((review) => review.action === 'reject')
        .map((review) => ({
          annotationCount: review.annotations?.length || undefined,
          attachments: review.attachments,
          checkId: check.id,
          checkSeq: check.seq,
          comment: review.comment ?? '',
          createdAt: review.createdAt,
          kind: 'check' as const,
          roundIndex: review.roundIndex,
          stale: review.roundIndex < currentRoundIndex,
          title: check.title,
        })),
    ),
    ...groupFeedbackEntries.map((entry) => ({
      attachments: entry.attachments,
      comment: entry.comment,
      createdAt: entry.createdAt,
      groupLabel: entry.category,
      kind: 'group' as const,
      roundIndex: entry.roundIndex,
      stale: entry.roundIndex < currentRoundIndex,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const runAction = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await mutate();
      void globalMutate(isAcceptanceListKey);
      return true;
    } catch (cause) {
      console.error('[acceptance:decision]', cause);
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const repairPrompt = buildRepairPrompt(acceptance.id);

  return (
    <>
      <DecisionBar
        acceptedCount={acceptedCount}
        embedded={embedded}
        feedbackCount={feedbackEntries.filter((entry) => !entry.stale).length}
        ignoredCount={ignoredCount}
        needsFixCount={needsFixCount}
        pending={pending}
        repairing={acceptance.status === 'repairing'}
        rerunAvailable={embedded}
        rerunPending={false}
        state={barState}
        statusText={barTexts.statusText}
        subText={subTextWithApprovals || undefined}
        totalCount={reviewTotal}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onAccept={() =>
          openAcceptModal({
            exceptions: checks.filter((check) => isException(check)).map((check) => check.title),
            onConfirm: () => runAction(() => verifyService.acceptDelivery(acceptance.id)),
            subjectTitle: data.subject.title ?? data.subject.id,
          })
        }
        onAddComment={() =>
          openGroupFeedbackModal({
            description: t('acceptance.bar.addCommentDescription'),
            groupLabel: t('acceptance.feedback.global'),
            onConfirm: (comment, fileIds) =>
              runAction(() =>
                verifyService.addGroupFeedback({
                  category: '',
                  comment,
                  fileIds: fileIds.length > 0 ? fileIds : undefined,
                  id: acceptance.id,
                }),
              ).then(Boolean),
            title: t('acceptance.bar.addComment'),
          })
        }
        onCopyReview={async () => {
          await copyToClipboard(repairPrompt);
          toast.success({
            placement: 'top',
            title: t('acceptance.bar.copied'),
          });
        }}
        onRejectComment={() =>
          openRejectModal({
            onConfirm: (comment) =>
              runAction(() => verifyService.rejectDelivery(acceptance.id, comment)),
          })
        }
        onRerun={async () => {
          if (embedded) {
            // The origin conversation's composer sits right beside the portal —
            // draft the repair prompt into it so the user reviews and sends it.
            // No receiver attached (composer still mounting, or the portal is
            // hosted away from a conversation, e.g. the Home drawer): fall back
            // to the clipboard so the click always hands the prompt over.
            if (onDraftToComposer?.(repairPrompt)) {
              toast.success({
                placement: 'top',
                title: t('acceptance.bar.rerunDrafted'),
              });
            } else {
              await copyToClipboard(repairPrompt);
              toast.success({
                placement: 'top',
                title: t('acceptance.bar.copied'),
              });
            }
            return;
          }
        }}
      />
      <Flexbox style={{ height: 8 }} />
      <FeedbackDrawer
        entries={feedbackEntries}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onJumpToCheck={(checkId) => {
          setFeedbackOpen(false);
          if (!embedded) {
            navigate(acceptanceCheckPath(acceptanceId, checkId));
            return;
          }
          setTimeout(() => {
            document
              .querySelector(`[data-check-row="${checkId}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 80);
        }}
      />
    </>
  );
};

export default AcceptanceDecision;
