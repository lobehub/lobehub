'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, ListTodo, Loader2, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /* Floats over the scrolling checklist — the decision stays reachable
     however deep the review goes. */
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;

    display: flex;
    gap: 14px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 50%;
  `,
}));

type BarState = 'accepted' | 'live' | 'rejected' | 'settled';

/**
 * The review-progress dial: how many checks the user has signed off, of all.
 * At zero it reads as a dashed "not started" circle; the completed state is
 * rendered by the bar as the BadgeCheck disc, not here.
 */
const ProgressRing = memo<{ done: number; total: number }>(({ done, total }) => {
  const size = 36;
  const stroke = 3.5;
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
  /** Active (not-yet-consumed) feedback recorded this round. */
  feedbackCount: number;
  onAccept: () => void;
  /** Copy the hardcoded repair prompt for pasting to any agent. */
  onCopyReview: () => void;
  onOpenFeedback: () => void;
  /** Open the aggregate reject dialog (comment required). */
  onRejectComment: () => void;
  /** Dispatch the repair prompt straight into the origin agent conversation. */
  onRerun: () => void;
  pending: boolean;
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
    feedbackCount,
    onAccept,
    onCopyReview,
    onOpenFeedback,
    onRejectComment,
    onRerun,
    pending,
    rerunAvailable,
    rerunPending,
    state,
    statusText,
    subText,
    totalCount,
  }) => {
    const { t } = useTranslation('verify');

    const stateMeta = {
      accepted: { bg: cssVar.colorSuccessBg, color: cssVar.colorSuccess, icon: BadgeCheck },
      live: { bg: cssVar.colorInfoBg, color: cssVar.colorInfo, icon: Loader2 },
      rejected: { bg: cssVar.colorErrorBg, color: cssVar.colorError, icon: RotateCcw },
      settled: null,
    }[state];

    const allConfirmed = totalCount > 0 && acceptedCount >= totalCount;
    const hasFeedback = feedbackCount > 0;

    return (
      <div className={styles.bar}>
        {stateMeta || allConfirmed ? (
          // A fully signed-off review earns the badge, not a maxed-out dial —
          // the same mark the accepted state carries.
          <div
            className={styles.glyph}
            style={{ background: stateMeta?.bg ?? cssVar.colorSuccessBg }}
          >
            <Icon
              color={stateMeta?.color ?? cssVar.colorSuccess}
              icon={stateMeta?.icon ?? BadgeCheck}
              size={18}
              spin={state === 'live'}
            />
          </div>
        ) : (
          <ProgressRing done={acceptedCount} total={totalCount} />
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
            the reviewer may still hand the prompt to another agent. */}
        {state === 'live' && hasFeedback && (
          <Button disabled={pending} style={{ flex: 'none' }} type={'fill'} onClick={onCopyReview}>
            {t('acceptance.bar.copyReview')}
          </Button>
        )}

        {state === 'settled' &&
          (hasFeedback ? (
            // Feedback is queued — the delivery isn't being accepted now; the
            // bar's job is getting the repair round started.
            <>
              <Button
                disabled={pending}
                style={{ flex: 'none' }}
                type={'fill'}
                onClick={onCopyReview}
              >
                {t('acceptance.bar.copyReview')}
              </Button>
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
