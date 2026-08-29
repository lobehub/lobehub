'use client';

import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import { checkFilterState, isException } from './CheckList';
import { buildRepairPrompt } from './checkWork';
import DecisionBar from './DecisionBar';
import FeedbackDrawer, { type FeedbackListEntry } from './FeedbackDrawer';
import { openAcceptModal, openGroupFeedbackModal, openRejectModal } from './modals';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { formatAcceptanceCountsText, LIVE_ACCEPTANCE_STATUSES } from './verdict';

const AcceptanceDecision = () => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [pending, setPending] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  if (!data?.isOwner || data.acceptance.status === 'closed') return null;

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
    } finally {
      setPending(false);
    }
  };

  const repairPrompt = buildRepairPrompt(acceptance.id);

  return (
    <>
      <DecisionBar
        acceptedCount={acceptedCount}
        feedbackCount={feedbackEntries.filter((entry) => !entry.stale).length}
        ignoredCount={ignoredCount}
        needsFixCount={needsFixCount}
        pending={pending}
        repairing={acceptance.status === 'repairing'}
        state={barState}
        statusText={barTexts.statusText}
        subText={barTexts.subText}
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
            placement: 'bottom',
            style: { marginBlockEnd: 88 },
            title: t('acceptance.bar.copied'),
          });
        }}
        onRejectComment={() =>
          openRejectModal({
            onConfirm: (comment) =>
              runAction(() => verifyService.rejectDelivery(acceptance.id, comment)),
          })
        }
      />
      <Flexbox style={{ height: 8 }} />
      <FeedbackDrawer
        entries={feedbackEntries}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onJumpToCheck={(checkId) => {
          setFeedbackOpen(false);
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
