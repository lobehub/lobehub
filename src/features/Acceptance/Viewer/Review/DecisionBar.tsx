'use client';

import type { ButtonProps } from '@lobehub/ui';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  BadgeCheck,
  CircleAlert,
  ListTodo,
  Loader2,
  Lock,
  MessageSquarePlus,
  RotateCcw,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { acceptanceContentLayout } from '../layout';

const orbit = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const completePop = stylex.keyframes({
  '0%': { opacity: 0, transform: 'scale(0.5)' },
  '55%': { transform: 'scale(1)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

const reducedMotion = '@media (prefers-reduced-motion: reduce)';
const phone = '@media (width <= 767px)';
const narrow = '@media (width <= 480px)';

// The page's text measure, from the shared layout constants StyleX cannot read.
const barMaxWidth = acceptanceContentLayout.maxWidth - 2 * acceptanceContentLayout.paddingInline;

const styles = stylex.create({
  repairingArc: {
    transformOrigin: 'center',
    animationName: { default: orbit, [reducedMotion]: 'none' },
    animationDuration: '1.2s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  // Floats over the scrolling checklist — the decision stays reachable
  // however deep the review goes.
  bar: {
    position: 'sticky',
    zIndex: 20,
    insetBlockEnd: { default: '16px', [phone]: 'max(8px, env(safe-area-inset-bottom))' },
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center',
    width: '100%',
    marginInline: 'auto',
    paddingBlock: '12px',
    paddingInline: { default: '16px', [phone]: '12px' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
  },
  summary: {
    flex: '1',
    minWidth: '160px',
  },
  actions: {
    flex: 'none',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    width: { default: null, [narrow]: '100%' },
  },
  // The bar's own buttons (the old `.actions > button`).
  actionButton: {
    flex: { default: 'none', [narrow]: '1' },
  },
  // The completion mark springs in the instant review finishes — the felt beat
  // the abrupt ring→disc swap never had, landing at the decision bar where the
  // user's next action (accept / send back) already is, not behind a filter.
  completePop: {
    animationName: { default: completePop, [reducedMotion]: 'none' },
    animationDuration: '0.2s',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
});

const ActionButton = (props: ButtonProps) => (
  <Button {...props} {...stylex.props(styles.actionButton)} />
);

type BarState = 'accepted' | 'live' | 'rejected' | 'settled';

/**
 * The review-progress dial: how many checks the user has signed off, of all.
 * At zero it reads as a dashed "not started" circle; the completed state is
 * rendered by the bar as the BadgeCheck disc, not here.
 */
/**
 * A repair round in flight: a steady wrench — what is happening — inside a
 * travelling arc — that it is still happening. Same ring geometry as the review
 * dial, so the bar's marks read as one family instead of a spinning reload glyph.
 */
const RepairingMark = memo(() => {
  const size = 20;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ flex: 'none', height: size, position: 'relative', width: size }}>
      <svg height={size} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorWarningBg}
          strokeWidth={stroke}
        />
        <circle
          {...stylex.props(styles.repairingArc)}
          cx={size / 2}
          cy={size / 2}
          fill={'none'}
          r={radius}
          stroke={cssVar.colorWarning}
          strokeDasharray={`${circumference * 0.3} ${circumference}`}
          strokeLinecap={'round'}
          strokeWidth={stroke}
        />
      </svg>
      <Flexbox align={'center'} justify={'center'} style={{ inset: 0, position: 'absolute' }}>
        <Icon color={cssVar.colorWarning} icon={Wrench} size={10} />
      </Flexbox>
    </div>
  );
});

RepairingMark.displayName = 'AcceptanceRepairingMark';

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
  /** Rendered inside the conversation portal — the composer beside the bar
      receives the repair draft, so the copy handoff stays standalone-only. */
  embedded?: boolean;
  /** Active (not-yet-consumed) feedback recorded this round. */
  feedbackCount: number;
  /** Checks removed from the acceptance scope by the reviewer. */
  ignoredCount: number;
  /** Checks the user reviewed as needing a fix (待修复) — decided, not pending. */
  needsFixCount: number;
  onAccept: () => void;
  /** Record a global (uncategorized) comment for the next round. */
  onAddComment: () => void;
  /** Copy the hardcoded repair prompt for pasting to any agent. */
  onCopyReview: () => void;
  onOpenFeedback: () => void;
  /** Open the aggregate reject dialog (comment required). */
  onRejectComment: () => void;
  /** Start the repair round: embedded, drafts the prompt into the composer
      beside the bar. Standalone pages only copy the repair prompt. */
  onRerun: () => void;
  pending: boolean;
  /** The viewer may weigh in but not decide: the closing actions stay on the
      bar, disabled, with this reason shown beside them. */
  readOnlyReason?: string;
  /** The viewer was granted reject access: reject is live, accept stays
      disabled, and this reason says who accepts. */
  rejectOnlyReason?: string;
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
 * repair handoff (打回重跑: embedded drafts the prompt into the composer
 * beside the bar; standalone copies the repair prompt);
 * a clean review offers reject-with-comment and accept, with accept gaining
 * primary weight only once every check is signed off.
 */
const DecisionBar = memo<DecisionBarProps>(
  ({
    acceptedCount,
    embedded,
    feedbackCount,
    ignoredCount,
    needsFixCount,
    onAccept,
    onAddComment,
    onCopyReview,
    onOpenFeedback,
    onRejectComment,
    onRerun,
    pending,
    readOnlyReason,
    rejectOnlyReason,
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
      // A repair round renders its own RepairingMark below; a plain verify
      // stays a neutral info spinner.
      live: { color: cssVar.colorInfo, icon: Loader2 },
      rejected: { color: cssVar.colorError, icon: RotateCcw },
      settled: null,
    }[state];

    const allConfirmed = totalCount > 0 && acceptedCount + ignoredCount >= totalCount;
    const hasFeedback = feedbackCount > 0;
    // The dial tracks DECIDED checks (accepted + 待修复), so a fully-reviewed
    // union reads as done even when some checks still need a fix.
    const decidedCount = acceptedCount + needsFixCount + ignoredCount;
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
      <div {...sx([styles.bar], undefined, { maxWidth: barMaxWidth })}>
        <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.summary)}>
          {state === 'live' && repairing ? (
            <RepairingMark />
          ) : stateMeta ? (
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
              color={cssVar.colorSuccess}
              icon={BadgeCheck}
              size={22}
              {...sx([justCompleted && styles.completePop], undefined, { flex: 'none' })}
            />
          ) : settledNeedsFix ? (
            <Icon
              color={cssVar.colorWarning}
              icon={CircleAlert}
              size={22}
              {...sx([justCompleted && styles.completePop], undefined, { flex: 'none' })}
            />
          ) : (
            <ProgressRing done={decidedCount} total={totalCount} />
          )}
          <Flexbox gap={2} style={{ flex: '0 1 auto', minWidth: 0 }}>
            <Text ellipsis type={'secondary'}>
              {statusText}
            </Text>
            {subText && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {subText}
              </Text>
            )}
            {(readOnlyReason || rejectOnlyReason) && (
              <Flexbox
                horizontal
                align={'center'}
                data-testid={'acceptance-decision-reason'}
                gap={4}
              >
                <Icon
                  icon={readOnlyReason ? Lock : UsersRound}
                  size={12}
                  style={{ flex: 'none' }}
                />
                <Text fontSize={12} type={'secondary'}>
                  {readOnlyReason ?? rejectOnlyReason}
                </Text>
              </Flexbox>
            )}
          </Flexbox>

          {/* The clearing list — every note this round queues for the next one.
            Sits with the status reading on the left: it explains that reading,
            while the right side stays pure actions. */}
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
        </Flexbox>
        {readOnlyReason ? (
          // Not this viewer's call: the decision they are waiting on stays in
          // view, disabled, so the bar says who decides instead of vanishing.
          state === 'settled' && (
            <Flexbox horizontal gap={8} {...stylex.props(styles.actions)}>
              <ActionButton disabled title={readOnlyReason} type={'text'}>
                {t('acceptance.bar.rejectComment')}
              </ActionButton>
              <ActionButton disabled title={readOnlyReason} type={'fill'}>
                {t('acceptance.actions.accept')}
              </ActionButton>
            </Flexbox>
          )
        ) : rejectOnlyReason ? (
          // Granted reject access only: sending back is theirs, accepting is not.
          state === 'settled' && (
            <Flexbox horizontal className={styles.actions} gap={8}>
              <Button disabled={pending} type={'fill'} onClick={onRejectComment}>
                {t('acceptance.bar.rejectComment')}
              </Button>
              <Button disabled title={rejectOnlyReason} type={'fill'}>
                {t('acceptance.actions.accept')}
              </Button>
            </Flexbox>
          )
        ) : (
          <Flexbox horizontal gap={8} {...stylex.props(styles.actions)}>
            {/* A dispatched send-back (repairing) keeps the copy entry alive —
            the reviewer may still hand the prompt to another agent. Embedded,
            the composer beside it already receives the draft. */}
            {state === 'live' && hasFeedback && !embedded && (
              <ActionButton disabled={pending} type={'fill'} onClick={onCopyReview}>
                {t('acceptance.bar.copyReview')}
              </ActionButton>
            )}

            {(state === 'settled' || state === 'rejected') &&
              (hasFeedback || state === 'rejected' ? (
                // Feedback is queued — the delivery isn't being accepted now; the
                // bar's job is getting the repair round started.
                <>
                  {/* Last words before the repair leaves — a global note the next
                  round reads, for what the queued per-check feedback missed. */}
                  <ActionButton
                    disabled={pending}
                    icon={<Icon icon={MessageSquarePlus} />}
                    type={'fill'}
                    onClick={onAddComment}
                  >
                    {t('acceptance.bar.addComment')}
                  </ActionButton>
                  {/* One commit action per host: standalone copies the repair
                  prompt; embedded drafts it into the composer beside the bar. */}
                  {(!embedded || rerunAvailable) && (
                    <ActionButton
                      disabled={pending}
                      loading={embedded && rerunPending}
                      type={'primary'}
                      onClick={embedded ? onRerun : onCopyReview}
                    >
                      {t(embedded ? 'acceptance.bar.rerun' : 'acceptance.bar.copyReview')}
                    </ActionButton>
                  )}
                </>
              ) : (
                // Clean review — accept carries primary weight only once every
                // check is signed off; before that it stays a quiet option.
                <>
                  <ActionButton disabled={pending} type={'text'} onClick={onRejectComment}>
                    {t('acceptance.bar.rejectComment')}
                  </ActionButton>
                  <ActionButton
                    disabled={pending}
                    type={allConfirmed ? 'primary' : 'fill'}
                    onClick={onAccept}
                  >
                    {t('acceptance.actions.accept')}
                  </ActionButton>
                </>
              ))}
          </Flexbox>
        )}
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
