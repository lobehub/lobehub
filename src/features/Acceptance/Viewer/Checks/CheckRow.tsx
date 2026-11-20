'use client';

import { isCheckWaivedByDispute } from '@lobechat/const/verify';
import { cssVar, Flexbox, useResponsive } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Scale } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readVisualizationManifest } from '../../Report/visualization';
import { checkDisplayTitle } from '../../utils';
import { useCheckComments } from '../Comments/useCheckComments';
import { canMarkEvidence, evidenceCounts, evidenceShortcut } from '../Evidence/evidence';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { checkDecision } from './checkDecision';
import { collectEvidenceById } from './CheckHistory';
import { CheckRowEvidence } from './CheckRowEvidence';
import { CheckRowHeader } from './CheckRowHeader';
import { CheckRowSide } from './CheckRowSide';
import { userReviewState } from './checkState';
import { STATE_META } from './checkStatus';
import PhoneDecisionBar from './PhoneDecisionBar';
import { splitCheckReviews } from './readPresentation';
import { checkRowDisclosure } from './rowDisclosure';
import { styles } from './styles';
import type { AcceptanceCheck, CheckReviewInput, ProposalDismissInput } from './types';
import { useCheckReviewActions } from './useCheckReviewActions';

export const AcceptanceCheckRow = memo<{
  canReview: boolean;
  check: AcceptanceCheck;
  detailMode?: boolean;
  expanded: boolean;
  /** Answer a model proposal WITHOUT ruling on the check itself. */
  onDismissProposal?: (input: ProposalDismissInput) => Promise<void>;
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound?: (round: number) => void;
  /**
   * Open this check on its own page instead of disclosing it in place. Set on
   * a phone, where a row that unfolds a full evidence review inside a scrolling
   * list buries both the check above it and the one below.
   */
  onOpenDetail?: () => void;
  /** Open an agent judge's verification run (its trace IS the argument). */
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  onToggle: () => void;
  reviewPending: boolean;
}>(
  ({
    canReview,
    check,
    detailMode,
    expanded,
    onDismissProposal,
    onOpenDetail,
    onOpenTrace,
    onReview,
    onRound,
    onToggle,
    reviewPending,
  }) => {
    const { t } = useTranslation('verify');
    const { md: desktop = true } = useResponsive();
    // The judging narrative stays collapsed: level one is title + evidence.
    const [historyOpen, setHistoryOpen] = useState(false);
    // The proposal starts folded: it is a suggestion, and an open panel on every
    // unreviewed check would push the evidence the reviewer came for below the fold.
    const [proposalOpen, setProposalOpen] = useState(false);
    const meta = STATE_META[check.state];
    const { activate, ariaExpanded, open } = checkRowDisclosure({
      expanded,
      onOpenDetail,
      onToggle,
    });
    const title = checkDisplayTitle(check.title, t('acceptance.checks.holisticTitle'));
    const counts = evidenceCounts(check.evidence);
    const visualization = readVisualizationManifest(check.result?.metadata);
    // An upheld `invalid_criterion` dispute takes the check out of the rollup,
    // so its failed mark must not keep reading as a blocker.
    const waived = isCheckWaivedByDispute(check.result?.metadata);

    const reviewState = userReviewState(check);
    // The decision is stamped on the check's result row — a never-executed
    // check has no evidence to judge, so it exposes no review actions.
    const reviewable = canReview && Boolean(check.result);
    // The standing verdict is always the newest entry; consumed verdicts belong to history.
    const { activeReview, historyReviews } = splitCheckReviews(check);
    const evidenceById = collectEvidenceById(check);

    // Regions the proposal wants drawn on the evidence images already in this
    // row. Numbered across the whole proposal (not per image), so "区域 2" in
    // the card means the same box wherever it lives. Only while the card is
    // open — boxes with no visible explanation read as a defect of the evidence.
    const proposalOverlays = useMemo(() => {
      if (!proposalOpen || !check.prediction) return undefined;
      const map: EvidenceOverlayMap = new Map();
      (check.prediction.annotations ?? []).forEach((annotation, index) => {
        const bucket = map.get(annotation.evidenceId) ?? [];
        bucket.push({ comment: annotation.comment, label: index + 1, rect: annotation.rect });
        map.set(annotation.evidenceId, bucket);
      });
      return map.size > 0 ? map : undefined;
    }, [proposalOpen, check.prediction]);

    const checkComments = useCheckComments(check, proposalOverlays);
    const { checkThreads, staleThreads, canCommentEvidence, openEvidenceComment } = checkComments;

    const review = useCheckReviewActions({
      activeReview,
      check,
      expanded,
      onDismissProposal,
      onReview,
      onToggle,
      refreshEvidenceUrl: checkComments.refreshEvidenceUrl,
      title,
    });
    const { openReject } = review;

    // Comments and review decisions have distinct entry points for every role.
    const shortcut = evidenceShortcut({
      canComment: canCommentEvidence,
      canMark: reviewable && !activeReview && canMarkEvidence(check, desktop),
      // EvidenceList turns a phone reviewer's tap into the same marking.
      tapMarks: !desktop && canReview,
    });
    const floatingComment = (() => {
      switch (shortcut) {
        case 'comment': {
          return { label: t('acceptance.comments.commentMedia'), open: openEvidenceComment };
        }
        case 'annotate': {
          return {
            label: t('acceptance.review.annotate'),
            open: (id: string) => openReject(undefined, id),
          };
        }
        default: {
          return undefined;
        }
      }
    })();

    // The head slot is the verifier's verdict and nothing else; the reviewer's
    // own decision reads from the label at the row's far end, so one glyph
    // never has to mean two things.
    const headIcon = waived ? Scale : meta.icon;
    const headColor = waived ? cssVar.colorTextQuaternary : meta.color;
    const verdictLabel = `${t('acceptance.focus.judgeLabel')} · ${t(
      `report.verdict.${check.state === 'not_executed' ? 'notExecuted' : check.state}`,
    )}`;

    const hasEvidenceColumn =
      check.evidence.length > 0 ||
      Boolean(visualization) ||
      staleThreads.length > 0 ||
      check.state === 'not_executed';
    const fillStage = Boolean(detailMode) && desktop && counts.image > 0;
    const phoneBar = Boolean(detailMode) && !desktop && reviewable && !activeReview;

    return (
      <Flexbox
        data-check-row={check.id}
        {...stylex.props(detailMode ? styles.detailContainer : styles.row)}
      >
        {!detailMode && (
          <CheckRowHeader
            activate={activate}
            ariaExpanded={ariaExpanded}
            check={check}
            checkThreadCount={checkThreads.length}
            counts={counts}
            decision={checkDecision(check)}
            desktop={desktop}
            headColor={headColor}
            headIcon={headIcon}
            open={open}
            review={review}
            reviewPending={reviewPending}
            showQuickActions={desktop && !open && reviewable && reviewState === 'pending'}
            title={title}
            verdictLabel={verdictLabel}
            visualization={visualization}
            waived={waived}
            onRound={onRound}
          />
        )}

        {open && (
          <div
            {...stylex.props(
              styles.body,
              !detailMode && styles.bodyInList,
              !hasEvidenceColumn && styles.bodySingle,
              !detailMode && styles.bodyStacked,
            )}
          >
            {hasEvidenceColumn && (
              <CheckRowEvidence
                activeReview={activeReview}
                check={check}
                checkComments={checkComments}
                evidenceById={evidenceById}
                fillStage={fillStage}
                floatingComment={floatingComment}
                visualization={visualization}
                onReviewEvidence={canReview ? (id) => openReject(undefined, id) : undefined}
              />
            )}
            <CheckRowSide
              activeReview={activeReview}
              check={check}
              desktop={desktop}
              detailMode={detailMode}
              evidenceById={evidenceById}
              headColor={headColor}
              headIcon={headIcon}
              historyOpen={historyOpen}
              historyReviews={historyReviews}
              phoneBar={phoneBar}
              proposalOpen={proposalOpen}
              review={review}
              reviewPending={reviewPending}
              reviewable={reviewable}
              verdictLabel={verdictLabel}
              visualization={visualization}
              onCommentEvidence={canCommentEvidence ? () => openEvidenceComment() : undefined}
              onHistoryToggle={() => setHistoryOpen((open) => !open)}
              onOpenTrace={onOpenTrace}
              onProposalToggle={setProposalOpen}
              onRound={onRound}
            />
          </div>
        )}
        {phoneBar && (
          <PhoneDecisionBar
            accepting={review.accepting}
            ignoring={review.ignoring}
            reviewPending={reviewPending}
            onAccept={review.handleAccept}
            onComment={canCommentEvidence ? () => openEvidenceComment() : undefined}
            onIgnore={review.handleIgnore}
            onReject={() => openReject()}
          />
        )}
      </Flexbox>
    );
  },
);
