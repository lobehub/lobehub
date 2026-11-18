'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ListTodo, Lock, UsersRound } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { DecisionSegment } from '../Checks/checkDecision';
import { DecisionActions } from './DecisionActions';
import { decisionBarStyles as styles } from './decisionBarStyles';
import type { DecisionBarState } from './DecisionMarks';
import { DecisionStatusMark } from './DecisionMarks';
import DecisionStrip from './DecisionStrip';
import { DecisionTally } from './DecisionTally';

interface DecisionBarProps {
  /** Checks the user has signed off, of `totalCount` reviewable ones. */
  acceptedCount: number;
  /** Docks the bar across the whole scroll frame — its rule then mirrors the
      header band's under the tabs — while the content keeps to a column this
      wide (the body column's max width, its padding included). The caller
      renders the bar after the column instead of inside it. */
  dockedMaxWidth?: number;
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
  segments?: DecisionSegment[];
  state: DecisionBarState;
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
    dockedMaxWidth,
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
    segments,
    state,
    statusText,
    subText,
    totalCount,
  }) => {
    const { t } = useTranslation('verify');
    const docked = dockedMaxWidth !== undefined;

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
    // acceptance) and never on an unrelated re-render. The first render seeds
    // the baseline, so only a later change of `reviewComplete` can fire.
    const reviewComplete = allConfirmed || settledNeedsFix;
    const [seenComplete, setSeenComplete] = useState(reviewComplete);
    const [justCompleted, setJustCompleted] = useState(false);
    if (seenComplete !== reviewComplete) {
      setSeenComplete(reviewComplete);
      setJustCompleted(reviewComplete);
    }

    return (
      <div {...stylex.props(styles.bar, docked && styles.barDocked)}>
        {segments && segments.length > 0 && (
          <DecisionStrip
            pendingXstyle={styles.stripPending}
            segmentXstyle={styles.stripSegment}
            segments={segments}
            xstyle={styles.strip}
            label={t('acceptance.bar.stripLabel', {
              accepted: acceptedCount,
              total: segments.length,
            })}
          />
        )}
        <div
          {...sx(
            styles.content,
            docked && styles.contentDocked,
            docked ? { maxWidth: dockedMaxWidth } : undefined,
          )}
        >
          <Flexbox horizontal align={'flex-start'} gap={10} {...stylex.props(styles.summary)}>
            <span {...stylex.props(styles.mark)}>
              <DecisionStatusMark
                allConfirmed={allConfirmed}
                decidedCount={decidedCount}
                justCompleted={justCompleted}
                repairing={repairing}
                settledNeedsFix={settledNeedsFix}
                state={state}
                totalCount={totalCount}
              />
            </span>
            <Flexbox gap={0} style={{ flex: '0 1 auto', minWidth: 0 }}>
              <Text ellipsis {...stylex.props(styles.statusText)}>
                {statusText}
              </Text>
              {state === 'settled' && totalCount > 0 && (
                <DecisionTally
                  acceptedCount={acceptedCount}
                  ignoredCount={ignoredCount}
                  needsFixCount={needsFixCount}
                  pendingCount={Math.max(totalCount - decidedCount, 0)}
                />
              )}
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
          <DecisionActions
            allConfirmed={allConfirmed}
            embedded={embedded}
            hasFeedback={hasFeedback}
            pending={pending}
            readOnlyReason={readOnlyReason}
            rejectOnlyReason={rejectOnlyReason}
            rerunAvailable={rerunAvailable}
            rerunPending={rerunPending}
            state={state}
            onAccept={onAccept}
            onAddComment={onAddComment}
            onCopyReview={onCopyReview}
            onRejectComment={onRejectComment}
            onRerun={onRerun}
          />
        </div>
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
