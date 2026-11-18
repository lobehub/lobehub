import { Button, cssVar, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight, Images, Route } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { readVisualizationManifest } from '../../Report/visualization';
import { hasRenderableEvidence } from '../../Report/visualization';
import { canMarkEvidence } from '../Evidence/evidence';
import ProposalCard from '../Review/ProposalCard';
import { IterationTimeline } from './CheckHistory';
import { CheckRowSideActions } from './CheckRowSideActions';
import { readCheckDispute } from './dispute';
import DisputeNote from './DisputeNote';
import FoldedText from './FoldedText';
import { hasCheckHistory } from './readPresentation';
import StandingDecision from './StandingDecision';
import { styles } from './styles';
import type { AcceptanceCheck, AcceptanceCheckReviewEntry, AcceptanceEvidence } from './types';
import type { CheckReviewActions } from './useCheckReviewActions';

const RecordBox = ({ children }: { children: ReactNode }) => (
  <Flexbox
    paddingBlock={6}
    paddingInline={10}
    style={{
      background: cssVar.colorFillQuaternary,
      borderRadius: cssVar.borderRadius,
      width: '100%',
    }}
  >
    {children}
  </Flexbox>
);

const VerifierRecord = memo<{
  check: AcceptanceCheck;
  visualization: ReturnType<typeof readVisualizationManifest>;
}>(({ check, visualization }) => {
  const { t } = useTranslation('verify');

  if (check.state === 'not_executed' || !check.result) return null;
  if (check.result.toulmin?.reasoning)
    return (
      <RecordBox>
        <FoldedText
          label={t('acceptance.checks.judgeReason')}
          text={check.result.toulmin.reasoning}
        />
      </RecordBox>
    );
  if (hasRenderableEvidence(check.evidence.length, visualization)) return null;

  return (
    <RecordBox>
      <Text fontSize={12} type={'secondary'}>
        {t('acceptance.evidence.empty')}
      </Text>
    </RecordBox>
  );
});

VerifierRecord.displayName = 'AcceptanceCheckVerifierRecord';

interface CheckRowSideProps {
  activeReview?: AcceptanceCheckReviewEntry;
  check: AcceptanceCheck;
  desktop: boolean;
  detailMode?: boolean;
  evidenceById: Map<string, AcceptanceEvidence>;
  headColor: string;
  headIcon: LucideIcon;
  historyOpen: boolean;
  historyReviews: AcceptanceCheckReviewEntry[];
  onCommentEvidence?: () => void;
  onHistoryToggle: () => void;
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  onProposalToggle: (open: boolean) => void;
  onRound?: (round: number) => void;
  phoneBar: boolean;
  proposalOpen: boolean;
  review: CheckReviewActions;
  reviewable: boolean;
  reviewPending: boolean;
  verdictLabel: string;
  visualization: ReturnType<typeof readVisualizationManifest>;
}

export const CheckRowSide = memo<CheckRowSideProps>(
  ({
    activeReview,
    check,
    desktop,
    detailMode,
    evidenceById,
    headColor,
    headIcon,
    historyOpen,
    historyReviews,
    onCommentEvidence,
    onHistoryToggle,
    onOpenTrace,
    onProposalToggle,
    onRound,
    phoneBar,
    proposalOpen,
    review,
    reviewable,
    reviewPending,
    verdictLabel,
    visualization,
  }) => {
    const { t } = useTranslation('verify');
    const {
      accepting,
      handleAccept,
      handleAdjudicate,
      handleReject,
      openReject,
      rejecting,
      reviewComment,
      setReviewComment,
    } = review;
    const dispute = readCheckDispute(check.result?.metadata);
    const hasHistory = hasCheckHistory(check, historyReviews);
    const canDecide = reviewable && !activeReview;

    // A row opened in the list: the evidence above already took the full
    // width, so the judging closes it as one compact bar — the verdict and
    // its folded reason on the first line, the decision on the last.
    if (!detailMode) {
      const traceId =
        check.planItem?.verifierType === 'agent' ? check.result?.verifierOperationId : undefined;
      const leading = (
        <>
          {hasHistory && (
            <span {...stylex.props(styles.historyToggle)} onClick={onHistoryToggle}>
              <Icon
                icon={ChevronRight}
                size={12}
                style={{
                  transform: historyOpen ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
              {t('acceptance.checks.iterationHistory', { count: check.revisions })}
            </span>
          )}
          {/* `onOpenTrace` gates the render, not just the click — see the
          detail layout below for why. */}
          {traceId && onOpenTrace && (
            <Button
              icon={<Icon icon={Route} />}
              size={'small'}
              type={'text'}
              onClick={(event) => {
                event.stopPropagation();
                void onOpenTrace(traceId);
              }}
            >
              {t('acceptance.checks.viewTrace')}
            </Button>
          )}
        </>
      );
      const hasLeading = hasHistory || Boolean(traceId && onOpenTrace);

      return (
        <Flexbox gap={12} style={{ minWidth: 0 }}>
          {check.prediction && canDecide && (
            <ProposalCard
              open={proposalOpen}
              pending={reviewPending}
              proposal={check.prediction}
              onAdjudicate={handleAdjudicate}
              onConfirm={() => openReject(check.prediction ?? undefined)}
              onToggle={onProposalToggle}
            />
          )}
          <div {...stylex.props(styles.verdictBar)}>
            <div {...stylex.props(styles.verdictLine)}>
              <span {...stylex.props(styles.verdictLabel)}>
                <Icon color={headColor} icon={headIcon} size={16} style={{ flex: 'none' }} />
                <Text weight={500}>{verdictLabel}</Text>
              </span>
              {check.result?.toulmin?.evidence && (
                <div {...stylex.props(styles.verdictReason)}>
                  <FoldedText secondary text={check.result.toulmin.evidence} />
                </div>
              )}
            </div>
            <VerifierRecord check={check} visualization={visualization} />
            {dispute && <DisputeNote dispute={dispute} />}
            {historyOpen && hasHistory && (
              <IterationTimeline
                check={check}
                evidenceById={evidenceById}
                historyReviews={historyReviews}
                onRound={onRound}
              />
            )}
            {activeReview && (
              <StandingDecision
                accepting={accepting}
                evidenceById={evidenceById}
                review={activeReview}
                reviewPending={reviewPending}
                onAccept={reviewable ? handleAccept : undefined}
                onReject={reviewable ? () => openReject() : undefined}
              />
            )}
            {(Boolean(onCommentEvidence) || canDecide || hasLeading) && (
              <CheckRowSideActions
                inline
                leading={leading}
                review={review}
                reviewPending={reviewPending}
                showDecision={canDecide}
                onCommentEvidence={onCommentEvidence}
              />
            )}
          </div>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12} {...stylex.props(styles.side)}>
        {/* The model's proposal leads the side column: it is a claim about
        this check that the reviewer is being asked to rule on, so it sits
        above the verifier's verdict rather than buried under it.
        Suppressed once a verdict exists — see the bundle read, which
        already drops it; this guard covers the optimistic window. */}
        {check.prediction && canDecide && (
          <ProposalCard
            open={proposalOpen}
            pending={reviewPending}
            proposal={check.prediction}
            onAdjudicate={handleAdjudicate}
            onConfirm={() => openReject(check.prediction ?? undefined)}
            onToggle={onProposalToggle}
          />
        )}
        {/* The verifier's account of what it saw. Folded to one line that
        opens in place: shown in full, it and the reasoning below turned an
        expanded check into a wall of text; an earlier clamp failed because
        it had no way to open. */}
        {check.result?.toulmin?.evidence && (
          <FoldedText secondary text={check.result.toulmin.evidence} />
        )}
        {/* An agent judge's argument is its run, not a paragraph — link the
        trace instead of trying to summarize it inline. `onOpenTrace`
        gates the render, not just the click: a caller that forgets to
        pass it would otherwise get a button whose optional call silently
        does nothing — exactly how this shipped dead in the portal. */}
        {check.planItem?.verifierType === 'agent' &&
          check.result?.verifierOperationId &&
          onOpenTrace && (
            <Flexbox horizontal>
              <Button
                icon={<Icon icon={Route} />}
                size={'small'}
                type={'text'}
                onClick={(event) => {
                  event.stopPropagation();
                  void onOpenTrace(check.result!.verifierOperationId!);
                }}
              >
                {t('acceptance.checks.viewTrace')}
              </Button>
            </Flexbox>
          )}
        {/* The verifier's record slot. An LLM judge's whole product IS its
        reasoning, so when it exists it IS the record shown here — in the
        same slot the empty-evidence note otherwise occupies (the two are
        the same statement: "here is what the verifier left behind"). An
        executed check with neither still SAYS so — a silent blank under
        the verdict reads as a rendering bug, not as a fact. */}
        <VerifierRecord check={check} visualization={visualization} />
        {/* The builder's objection sits under the verdict it argues with. */}
        {dispute && <DisputeNote dispute={dispute} />}

        {/* Circling the evidence belongs WITH the evidence, above the
        history — it is another way of looking at what was delivered,
        not a verdict. The rounds this check already went through then
        sit between that and the verdict buttons: context for the
        decision, never an appendix to one already made. */}
        {desktop && canDecide && canMarkEvidence(check, desktop) && (
          <Button
            outdent
            icon={<Icon icon={Images} />}
            style={{ alignSelf: 'flex-start' }}
            type={'text'}
            onClick={(event) => {
              event.stopPropagation();
              openReject();
            }}
          >
            {t('acceptance.review.annotate')}
          </Button>
        )}
        {hasHistory && (
          <span {...stylex.props(styles.historyToggle)} onClick={onHistoryToggle}>
            <Icon
              icon={ChevronRight}
              size={12}
              style={{
                transform: historyOpen ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
            {t('acceptance.checks.iterationHistory', { count: check.revisions })}
          </span>
        )}
        {historyOpen && hasHistory && (
          <IterationTimeline
            check={check}
            evidenceById={evidenceById}
            historyReviews={historyReviews}
            onRound={onRound}
          />
        )}
        {/* Both verdicts keep an undo path: a mis-click is the likeliest way
        either happens, and an unintended send-back costs a repair round. */}
        {activeReview && (
          <StandingDecision
            accepting={accepting}
            evidenceById={evidenceById}
            review={activeReview}
            reviewPending={reviewPending}
            onAccept={reviewable ? handleAccept : undefined}
            onReject={reviewable ? () => openReject() : undefined}
          />
        )}
        {/* The detail page decides in the stack below; this line only
        carries the comment entry. */}
        {!phoneBar && Boolean(onCommentEvidence) && (
          <CheckRowSideActions
            review={review}
            reviewPending={reviewPending}
            showDecision={false}
            onCommentEvidence={onCommentEvidence}
          />
        )}
        {canDecide && desktop && (
          <Flexbox gap={10} style={{ marginBlockStart: 6 }}>
            <TextArea
              autoSize={{ maxRows: 8, minRows: 3 }}
              placeholder={t('acceptance.review.detailPlaceholder')}
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
            />
            <div {...stylex.props(styles.detailStack)}>
              <Button
                block
                className={stylex.props(styles.detailStackItem).className}
                disabled={reviewPending || !reviewComment.trim()}
                loading={rejecting}
                size={'large'}
                onClick={handleReject}
              >
                {t('acceptance.review.reject')}
              </Button>
              <Button
                block
                className={stylex.props(styles.detailStackItem).className}
                disabled={reviewPending && !accepting}
                icon={<Icon icon={Check} />}
                loading={accepting}
                size={'large'}
                type={'primary'}
                onClick={handleAccept}
              >
                {t('acceptance.review.accept')}
              </Button>
            </div>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

CheckRowSide.displayName = 'AcceptanceCheckRowSide';
