import dayjs from 'dayjs';
import type { TFunction } from 'i18next';

import type { AcceptanceBundle } from '@/services/verify';

import { checkFilterState } from '../Checks/checkState';
import { formatAcceptanceCountsText, LIVE_ACCEPTANCE_STATUSES } from '../verdict';
import type { FeedbackListEntry } from './FeedbackDrawer';

type DecisionBundle = Pick<AcceptanceBundle, 'acceptance' | 'checks' | 'rounds'>;

/**
 * What the decision bar reads out — review progress, the state line, and the
 * feedback this acceptance has queued — derived from the bundle alone, so every
 * host that mounts the bar words the same state the same way.
 */
export const resolveDecisionView = (
  { acceptance, checks, rounds }: DecisionBundle,
  t: TFunction<'verify'>,
  { hydrated }: { hydrated: boolean },
) => {
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
  const barTexts: { statusText: string; subText: string | undefined } = {
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

  return {
    acceptedCount,
    barState,
    currentRound,
    feedbackEntries,
    ignoredCount,
    needsFixCount,
    reviewTotal,
    statusText: barTexts.statusText,
    subText: barTexts.subText,
  };
};
