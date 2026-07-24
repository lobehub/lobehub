'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, CircleAlert, ListTodo, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /* Floats over the scrolling checklist — the decision stays reachable
     however deep the review goes. */
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  // The completion mark springs in the instant review finishes — the felt beat
  // the abrupt ring→disc swap never had, landing at the decision bar where the
  // user's next action (accept / send back) already is, not behind a filter.
  completePop: css`
    @keyframes acceptance-decision-complete-pop {
      0% {
        transform: scale(0.5);
        opacity: 0;
      }

      55% {
        transform: scale(1.18);
      }

      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    animation: acceptance-decision-complete-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  `,
}));

type BarState = 'accepted' | 'live' | 'rejected' | 'settled';

/**
 * The review-progress dial: how many checks the user has signed off, of all.
 * At zero it reads as a dashed "not started" circle; the completed state is
 * rendered by the bar as the BadgeCheck disc, not here.
 */
const ProgressRing = memo<{ done: number; total: number }>(({ done, total }) => {
  const size = 20;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;

  if (done <= 0)
    return (
      <svg height={size} style={{ flex: 'none' }} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorTextQuaternary}
          strokeDasharray={'3 5'}
          strokeLinecap={'round'}
          strokeWidth={stroke}
        />
      </svg>
    );

  return (
    <div style={{ flex: 'none', height: size, position: 'relative', width: size }}>
      <svg height={size} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorFillSecondary}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorPrimary}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          strokeLinecap={'round'}
          strokeWidth={stroke}
          style={{ transition: 'stroke-dasharray 0.3s ease' }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Flexbox
        align={'center'}
        justify={'center'}
        style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', inset: 0, position: 'absolute' }}
      >
        <span style={{ color: cssVar.colorTextSecondary, fontWeight: 600 }}>{done}</span>
      </Flexbox>
    </div>
  );
});

ProgressRing.displayName = 'AcceptanceProgressRing';

interface DecisionBarProps {
  /** Checks the user has signed off, of `totalCount` reviewable ones. */
  acceptedCount: number;
  /**
   * Rendered as the in-chat portal embed. The send-back there drafts the repair
   * prompt straight into the composer sitting beside it, which makes "copy the
   * review" a redundant second way to move the same text — drop it and leave
   * one send-back path.
   */
  embedded?: boolean;
  /** Active (not-yet-consumed) feedback recorded this round. */
  feedbackCount: number;
  /** Checks the user reviewed as needing a fix (待修复) — decided, not pending. */
  needsFixCount: number;
  onAccept: () => void;
  /** Copy the hardcoded repair prompt for pasting to any agent. */
  onCopyReview: () => void;
  onOpenFeedback: () => void;
  /** Open the aggregate reject dialog (comment required). */
  onRejectComment: () => void;
  /** Dispatch the repair prompt straight into the origin agent conversation. */
  onRerun: () => void;
  pending: boolean;
  /** A live round that is a dispatched repair — coloured as an in-progress task
      (warning), not a neutral verify, to match the system's task-process cue. */
  repairing?: boolean;
  /** The origin conversation is known — the rerun dispatch has a target. */
  rerunAvailable: boolean;
  rerunPending: boolean;
  state: BarState;
  /** The state line, prepared by the page (status + counts wording). */
  statusText: string;
  subText?: string;
  totalCount: number;
}

/**
 * The floating decision strip (P-12): review progress, the feedback
 * clearing-list opener, and the closing actions. What the actions are follows
 * the review state — feedback queued for the next round turns the bar into a
 * repair dispatcher (copy the prompt / send it back to the origin agent);
 * a clean review offers reject-with-comment and accept, with accept gaining
 * primary weight only once every check is signed off.
 */
const DecisionBar = memo<DecisionBarProps>(
  ({
    acceptedCount,
    embedded,
    feedbackCount,
    needsFixCount,
    onAccept,
    onCopyReview,
    onOpenFeedback,
    onRejectComment,
    onRerun,
    pending,
    repairing,
    rerunAvailable,
    rerunPending,
    state,
    statusText,
    subText,
    totalCount,
  }) => {
    const { t } = useTranslation('verify');

    const stateMeta = {
      accepted: { color: cssVar.colorSuccess, icon: BadgeCheck },
      // A repair round is an in-progress TASK — warn-coloured refresh, matching
      // the task-process cue; a plain verify stays neutral info.
      live: repairing
        ? { color: cssVar.colorWarning, icon: RefreshCw }
        : { color: cssVar.colorInfo, icon: Loader2 },
      rejected: { color: cssVar.colorError, icon: RotateCcw },
      settled: null,
    }[state];

    const allConfirmed = totalCount > 0 && acceptedCount >= totalCount;
    const hasFeedback = feedbackCount > 0;
    // The dial tracks DECIDED checks (accepted + 待修复), so a fully-reviewed
    // union reads as done even when some checks still need a fix.
    const decidedCount = acceptedCount + needsFixCount;
    // Every check reviewed, but some need a fix — a review outcome, not a
    // success and not "still awaiting". Reads as an attention mark, never the
    // near-complete progress dial that made the state look like an all-clear.
    const settledNeedsFix =
      state === 'settled' && !allConfirmed && decidedCount >= totalCount && needsFixCount > 0;

    // Pop the completion mark only on the real IN-SESSION transition into a
    // finished review — never on mount-when-already-done (revisiting a settled
    // acceptance) and never on an unrelated re-render. Seed the ref to `null`
    // so the first render (whatever its state) is treated as the baseline, not
    // a transition: `prev === false && now` is the one edge that fires.
    const reviewComplete = allConfirmed || settledNeedsFix;
    const prevComplete = useRef<boolean | null>(null);
    const justCompleted = prevComplete.current === false && reviewComplete;
    useEffect(() => {
      prevComplete.current = reviewComplete;
    }, [reviewComplete]);

    return (
      <div className={styles.bar}>
        {stateMeta ? (
          // accepted / live / rejected — a plain coloured status mark.
          <Icon
            color={stateMeta.color}
            icon={stateMeta.icon}
            size={22}
            spin={state === 'live'}
            style={{ flex: 'none' }}
          />
        ) : allConfirmed ? (
          // Every check signed off — the same clean badge the accepted state carries.
          <Icon
            className={justCompleted ? styles.completePop : undefined}
            color={cssVar.colorSuccess}
            icon={BadgeCheck}
            size={22}
            style={{ flex: 'none' }}
          />
        ) : settledNeedsFix ? (
          <Icon
            className={justCompleted ? styles.completePop : undefined}
            color={cssVar.colorWarning}
            icon={CircleAlert}
            size={22}
            style={{ flex: 'none' }}
          />
        ) : (
          <ProgressRing done={decidedCount} total={totalCount} />
        )}
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text ellipsis strong style={{ fontSize: 14 }}>
            {statusText}
          </Text>
          {subText && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {subText}
            </Text>
          )}
        </Flexbox>

        {/* The clearing list — every note this round queues for the next one. */}
        {feedbackCount > 0 && (
          <Button
            icon={<Icon icon={ListTodo} />}
            size={'small'}
            style={{ flex: 'none' }}
            type={'text'}
            onClick={onOpenFeedback}
          >
            {t('acceptance.bar.feedback', { count: feedbackCount })}
          </Button>
        )}

        {/* A dispatched send-back (repairing) keeps the copy entry alive —
            the reviewer may still hand the prompt to another agent. Embedded,
            the composer beside it already receives the draft. */}
        {state === 'live' && hasFeedback && !embedded && (
          <Button disabled={pending} style={{ flex: 'none' }} type={'fill'} onClick={onCopyReview}>
            {t('acceptance.bar.copyReview')}
          </Button>
        )}

        {state === 'settled' &&
          (hasFeedback ? (
            // Feedback is queued — the delivery isn't being accepted now; the
            // bar's job is getting the repair round started.
            <>
              {!embedded && (
                <Button
                  disabled={pending}
                  style={{ flex: 'none' }}
                  type={'fill'}
                  onClick={onCopyReview}
                >
                  {t('acceptance.bar.copyReview')}
                </Button>
              )}
              {rerunAvailable && (
                <Button
                  disabled={pending}
                  loading={rerunPending}
                  style={{ flex: 'none' }}
                  type={'primary'}
                  onClick={onRerun}
                >
                  {t('acceptance.bar.rerun')}
                </Button>
              )}
            </>
          ) : (
            // Clean review — accept carries primary weight only once every
            // check is signed off; before that it stays a quiet option.
            <>
              <Button
                disabled={pending}
                style={{ flex: 'none' }}
                type={'text'}
                onClick={onRejectComment}
              >
                {t('acceptance.bar.rejectComment')}
              </Button>
              <Button
                disabled={pending}
                style={{ flex: 'none' }}
                type={allConfirmed ? 'primary' : 'fill'}
                onClick={onAccept}
              >
                {t('acceptance.actions.accept')}
              </Button>
            </>
          ))}
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
