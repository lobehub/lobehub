'use client';

import type { AcceptanceCommentThread } from '@lobechat/types';
import { copyToClipboard, Flexbox, Icon, TextArea, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar, cx, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import {
  AudioLines,
  BadgeCheck,
  Ban,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDashed,
  FileText,
  Film,
  Images,
  MessageSquare,
  MessageSquareX,
  Repeat,
  Route,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { hasRenderableEvidence, readVisualizationManifest } from '../../Report/visualization';
import { VisualizationDeltaBadge, VisualizationRenderer } from '../../Report/VisualizationRenderer';
import { checkDisplayTitle } from '../../utils';
import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceAuthorColor } from '../Comments/authorColor';
import { commentAuthorName } from '../Comments/CommentCard';
import CommentThread from '../Comments/CommentThread';
import { openEvidenceCommentModal } from '../Comments/EvidenceCommentModal';
import { useAcceptanceComments } from '../Comments/hooks';
import ThreadEvidence from '../Comments/ThreadEvidence';
import { threadsForCheck } from '../Comments/threads';
import { evidenceCounts, hasAnnotatableEvidence, isAnnotatable } from '../Evidence/evidence';
import { EvidenceList } from '../Evidence/EvidenceList';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { openCheckRejectModal } from '../Review/CheckRejectModal';
import type { CheckProposal } from '../Review/proposal';
import { classifyProposalEdit } from '../Review/proposal';
import ProposalCard from '../Review/ProposalCard';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import {
  AcceptedNote,
  collectEvidenceById,
  FeedbackCard,
  IgnoredNote,
  IterationTimeline,
} from './CheckHistory';
import { shouldCollapseAfterReview, userReviewState } from './checkState';
import { STATE_META } from './checkStatus';
import { checkRowDisclosure } from './rowDisclosure';
import { styles } from './styles';
import type { AcceptanceCheck, CheckReviewInput, ProposalDismissInput } from './types';

const EVIDENCE_BADGES = [
  { icon: Images, key: 'image', labelKey: 'acceptance.evidence.image' },
  { icon: Film, key: 'video', labelKey: 'acceptance.evidence.video' },
  { icon: AudioLines, key: 'audio', labelKey: 'acceptance.evidence.audio' },
  { icon: FileText, key: 'file', labelKey: 'acceptance.evidence.file' },
] as const;

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
    const [seqCopied, setSeqCopied] = useState(false);
    const [accepting, setAccepting] = useState(false);
    const [ignoring, setIgnoring] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
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

    const reviewState = userReviewState(check);
    // The decision is stamped on the check's result row — a never-executed
    // check has no evidence to judge, so it exposes no review actions.
    const reviewable = canReview && Boolean(check.result);
    const activeReview =
      check.userReview && !check.userReview.stale
        ? check.reviews.at(-1) // the standing verdict is always the newest entry
        : undefined;
    const historyReviews = check.reviews.filter((entry) => entry !== activeReview);
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
    const hasHistory = check.revisions > 1 || historyReviews.length > 0;

    // Collaboration: threads circled on this check's evidence. Only inside the
    // viewer — the row also renders in hosts with no acceptance scope.
    const scope = useOptionalAcceptanceScope();
    const { data: bundle } = useAcceptanceBundle(scope?.acceptanceId ?? '');
    const comments = useAcceptanceComments(scope?.acceptanceId);
    const authorColor = useAcceptanceAuthorColor();
    const viewerId = useUserStore(userProfileSelectors.userId);
    /**
     * Closing a note is a verdict on it: whoever raised it may close their own,
     * and the acceptance's reviewers may close anyone's. Ownership is read from
     * the author, not from `canDelete` — that flag also turns on for a
     * moderator, and borrowing it would silently hand the same power out.
     *
     * Memoized on the identity it reads: the profile arrives after the first
     * paint, and the overlay memo below would otherwise keep handing its
     * threads the answer computed while nobody was signed in.
     */
    const canResolveThread = useCallback(
      (thread: AcceptanceCommentThread) =>
        comments.canApprove ||
        (Boolean(viewerId) && thread.root.authorUserId === viewerId && !thread.root.deletedAt),
      [comments.canApprove, viewerId],
    );
    const checkThreads = useMemo(
      () => threadsForCheck(comments.threads, check.id),
      [comments.threads, check.id],
    );
    const commentActions = {
      onDelete: comments.remove,
      onReply: (rootId: string, content: string, attachments: { fileId: string }[]) =>
        comments.create({
          attachments,
          clientId: `${rootId}:${Date.now()}`,
          content,
          contextRunId: bundle?.rounds.at(-1)?.run.id,
          parentCommentId: rootId,
        }),
      onResolve: comments.setResolved,
    };
    // A region whose evidence a later round replaced: the box has nothing left
    // to sit on, so the thread renders under the evidence with its own copy of
    // the picture instead of disappearing.
    const showsNow = new Set(check.evidence.map((item) => item.id));
    const staleThreads = checkThreads.filter(
      (thread) => thread.root.evidenceId && !showsNow.has(thread.root.evidenceId),
    );
    // Each reviewer's regions carry their own colour, so two people circling
    // the same screenshot never read as one person's notes; the marker on the
    // box opens that thread in full — replies and all.
    const commentOverlays = useMemo(() => {
      const map: EvidenceOverlayMap = new Map(proposalOverlays ?? []);
      checkThreads.forEach((thread, index) => {
        const { author, authorUserId, evidenceId, rect, content, deletedAt } = thread.root;
        if (!evidenceId || !rect || deletedAt) return;
        const bucket = map.get(evidenceId) ?? [];
        bucket.push({
          authorAvatar: author.avatar,
          authorName: commentAuthorName(author),
          color: authorColor(authorUserId),
          comment: content,
          label: index + 1,
          panel: (
            <CommentThread
              canComment={comments.canComment}
              canResolve={canResolveThread(thread)}
              thread={thread}
              {...commentActions}
            />
          ),
          rect,
          resolved: Boolean(thread.root.resolvedAt),
        });
        map.set(evidenceId, bucket);
      });
      return map.size > 0 ? map : undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proposalOverlays, checkThreads, comments.canComment, canResolveThread, authorColor]);
    const canCommentEvidence =
      comments.canComment && Boolean(check.result) && hasAnnotatableEvidence(check);
    const openEvidenceComment = () =>
      openEvidenceCommentModal({
        evidence: check.evidence,
        onConfirm: async ({ content, evidenceId, rect }) => {
          await comments.create({
            anchor: { checkItemId: check.id, evidenceId, rect },
            clientId: `${check.id}:${Date.now()}`,
            content,
            contextRunId: bundle?.rounds.at(-1)?.run.id,
          });
          return true;
        },
      });

    /**
     * @param fromProposal - when set, the modal opens prefilled with the
     *   model's note and regions, and the submitted result is diffed against it
     *   so the signal records WHICH part of the proposal was wrong.
     */
    const openReject = (fromProposal?: CheckProposal, initialEvidenceId?: string) =>
      openCheckRejectModal({
        initialEvidenceId,
        previousAttachments:
          activeReview?.action === 'reject'
            ? activeReview.attachments
                ?.filter((item) => item.url)
                .map((item) => ({ id: item.id, name: item.name, url: item.url! }))
            : undefined,
        previousAnnotations:
          activeReview?.action === 'reject' ? activeReview.annotations : undefined,
        previousComment: activeReview?.action === 'reject' ? activeReview.comment : undefined,
        checkDescription: check.planItem?.description,
        checkTitle: `C${check.seq} · ${title}`,
        draftKey: `${check.result?.id ?? 'unexecuted'}:${check.id}`,
        evidence: check.evidence
          .filter((item) => isAnnotatable(item))
          .map((item) => ({ fileUrl: item.fileUrl!, id: item.id })),
        initialAnnotations: fromProposal?.annotations ?? undefined,
        initialComment: fromProposal?.comment ?? reviewComment,
        onConfirm: async ({ annotations, comment, fileIds }) => {
          const ok = await onReview({
            action: 'reject',
            annotations: annotations.length > 0 ? annotations : undefined,
            checkItemIds: [check.id],
            comment: comment || undefined,
            fileIds: fileIds.length > 0 ? fileIds : undefined,
            ...(fromProposal
              ? {
                  proposal: {
                    adjudication: 'confirmed' as const,
                    edit: classifyProposalEdit(fromProposal, { annotations, comment }),
                    predictionId: fromProposal.id,
                  },
                }
              : {}),
          });
          if (ok) {
            setReviewComment('');
            if (shouldCollapseAfterReview(ok, expanded)) onToggle();
          }
          return ok;
        },
      });

    /**
     * Dismissing a proposal is NOT a review of the check — the check stays
     * pending and the reviewer still has to judge it. Only the model's opinion
     * is being answered, so this writes the outcome without touching
     * `user_decision`.
     */
    const handleAdjudicate = async (adjudication: 'not-an-issue' | 'misidentified') => {
      if (!check.prediction) return;
      await onDismissProposal?.({
        adjudication,
        checkItemId: check.id,
        predictionId: check.prediction.id,
      });
    };

    // Accepting settles the check — the row folds itself away once the write
    // lands, so the reviewer's eye moves on to what still needs judgment.
    const handleAccept = async (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      setAccepting(true);
      const comment = reviewComment.trim();
      const ok = await onReview({
        action: 'accept',
        checkItemIds: [check.id],
        comment: comment || undefined,
      });
      setAccepting(false);
      if (ok) setReviewComment('');
      if (shouldCollapseAfterReview(ok, expanded)) onToggle();
    };

    const handleReject = async (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      const comment = reviewComment.trim();
      if (!comment) return;
      setRejecting(true);
      const ok = await onReview({
        action: 'reject',
        checkItemIds: [check.id],
        comment,
      });
      setRejecting(false);
      if (ok) setReviewComment('');
      if (shouldCollapseAfterReview(ok, expanded)) onToggle();
    };

    const handleIgnore = async (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      setIgnoring(true);
      const ok = await onReview({ action: 'ignore', checkItemIds: [check.id] });
      setIgnoring(false);
      if (shouldCollapseAfterReview(ok, expanded)) onToggle();
    };

    // The user's standing verdict owns the head slot: a reject replaces the
    // verifier's mark outright (that check IS sent back, whatever the verifier
    // said); passed + user-accepted merges into the double-check receipt.
    const headIcon =
      reviewState === 'rejected'
        ? MessageSquareX
        : reviewState === 'ignored'
          ? Ban
          : check.state === 'passed' && reviewState === 'accepted'
            ? CheckCheck
            : meta.icon;
    const headColor =
      reviewState === 'rejected'
        ? cssVar.colorError
        : reviewState === 'ignored'
          ? cssVar.colorTextQuaternary
          : meta.color;

    const headIconNode = (
      <Icon
        color={headColor}
        icon={headIcon}
        size={16}
        style={{ alignSelf: 'flex-start', flex: 'none', marginBlockStart: 3 }}
      />
    );

    return (
      <Flexbox className={detailMode ? undefined : styles.row} data-check-row={check.id}>
        {!detailMode && (
          <Flexbox
            horizontal
            align={'flex-start'}
            aria-expanded={ariaExpanded}
            className={styles.rowHeader}
            data-expanded={open ? '' : undefined}
            gap={10}
            role={'button'}
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                event.preventDefault();
                activate();
              }
            }}
          >
            {reviewState === 'rejected' ? (
              <Tooltip title={t('acceptance.review.rejectedHint')}>{headIconNode}</Tooltip>
            ) : (
              headIconNode
            )}
            <Tooltip
              title={seqCopied ? t('acceptance.checks.copied') : t('acceptance.checks.copySeq')}
            >
              <span
                className={cx(styles.seqChip, styles.seqChipClickable)}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyToClipboard(`C${check.seq}`);
                  setSeqCopied(true);
                  setTimeout(() => setSeqCopied(false), 1500);
                }}
              >
                C{check.seq}
              </span>
            </Tooltip>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.rowTitle}
              flex={1}
              gap={8}
              style={{ minWidth: 0 }}
              wrap={open ? 'wrap' : 'nowrap'}
            >
              <Text
                className={open || !desktop ? undefined : styles.titleEllipsis}
                style={{ fontSize: desktop ? 13 : 14, minWidth: 0 }}
              >
                {title}
              </Text>
              {!check.required && (
                <Tooltip title={t('acceptance.checks.notRequiredHint')}>
                  <Tag size={'small'}>{t('acceptance.checks.notRequired')}</Tag>
                </Tooltip>
              )}
              {/* The verdict pair travels WITH the title, not adrift at the row's
              far right: the claim you judge and the judgement you give land in
              one glance, so a long checklist needs no eye round-trip across the
              row (and no mis-click onto a neighbour's buttons). */}
              {desktop && reviewable && reviewState === 'pending' && (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={cx(styles.rowActions, 'acceptance-row-actions')}
                  gap={2}
                  style={{
                    // The accept spinner must stay visible after the pointer leaves.
                    ...(accepting ? { opacity: 1 } : undefined),
                    flex: 'none',
                  }}
                >
                  <ActionIcon
                    disabled={reviewPending && !accepting}
                    icon={Check}
                    loading={accepting}
                    size={'small'}
                    title={t('acceptance.review.accept')}
                    onClick={handleAccept}
                  />
                  <ActionIcon
                    disabled={reviewPending && !ignoring}
                    icon={Ban}
                    loading={ignoring}
                    size={'small'}
                    title={t('acceptance.review.ignore')}
                    onClick={handleIgnore}
                  />
                  <ActionIcon
                    disabled={reviewPending}
                    icon={MessageSquareX}
                    size={'small'}
                    title={t('acceptance.review.reject')}
                    onClick={(event) => {
                      event.stopPropagation();
                      openReject();
                    }}
                  />
                </Flexbox>
              )}
            </Flexbox>
            <Flexbox
              horizontal
              align={'center'}
              className={cx(styles.rowMeta, 'acceptance-row-meta')}
              gap={6}
            >
              {/* An accept on a NON-passed verdict can't merge into the head icon
              (the failed/uncertain mark must stay visible) — mark it here. */}
              {reviewState === 'accepted' && check.state !== 'passed' && (
                <Tooltip
                  title={t('acceptance.review.acceptedNote', {
                    time: dayjs(check.userReview!.createdAt).format('MM-DD HH:mm'),
                  })}
                >
                  <Icon color={cssVar.colorTextQuaternary} icon={BadgeCheck} size={14} />
                </Tooltip>
              )}
              {visualization && <VisualizationDeltaBadge manifest={visualization} />}
              {EVIDENCE_BADGES.map(({ icon, key, labelKey }) =>
                counts[key] ? (
                  <Tooltip key={key} title={t(labelKey, { count: counts[key] })}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={3}
                      style={{ color: cssVar.colorTextTertiary, fontSize: 11 }}
                    >
                      <Icon icon={icon} size={13} />
                      {counts[key] > 1 ? counts[key] : null}
                    </Flexbox>
                  </Tooltip>
                ) : null,
              )}
              {checkThreads.length > 0 && (
                <Tooltip
                  title={t('acceptance.comments.regionCount', { count: checkThreads.length })}
                >
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={3}
                    style={{ color: cssVar.colorTextTertiary, fontSize: 11 }}
                  >
                    <Icon icon={MessageSquare} size={13} />
                    {checkThreads.length}
                  </Flexbox>
                </Tooltip>
              )}
              {/* The iteration mark stays compact — [↻ N]; the words (verified N
              rounds · introduced in round X) live in its tooltip. Clicking
              jumps to the round the concern first appeared in. */}
              {onRound && check.revisions > 1 && (
                <Tooltip
                  title={[
                    check.titleChanged
                      ? t('acceptance.checks.iterated', { count: check.revisions })
                      : t('acceptance.checks.rerun', { count: check.revisions }),
                    check.resultRound !== undefined &&
                    check.resultRound !== null &&
                    check.introducedAtRound !== check.resultRound
                      ? t('acceptance.checks.introduced', { round: check.introducedAtRound })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span
                    className={cx(styles.chip, styles.chipClickable)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRound(check.introducedAtRound);
                    }}
                  >
                    <Icon icon={Repeat} size={10} /> {check.revisions}
                  </span>
                </Tooltip>
              )}
              {onRound && check.resultRound !== undefined && check.resultRound !== null && (
                <Tooltip title={t('acceptance.checks.finalRoundHint')}>
                  <span
                    className={cx(styles.chip, styles.chipClickable)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRound(check.resultRound!);
                    }}
                  >
                    {t('acceptance.round', { round: check.resultRound })}
                  </span>
                </Tooltip>
              )}
            </Flexbox>
            <Flexbox align={'center'} className={styles.rowChevron} height={22}>
              <Icon
                color={cssVar.colorTextQuaternary}
                icon={ChevronRight}
                size={14}
                style={{
                  transform: open ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </Flexbox>
          </Flexbox>
        )}

        {open && (
          <Flexbox
            gap={10}
            paddingBlock={detailMode ? 0 : '0 14px'}
            paddingInline={detailMode ? 0 : 16}
          >
            {/* The model's proposal leads the detail: it is a claim about this
              check that the reviewer is being asked to rule on, so it belongs
              above the verifier's narrative rather than buried under it.
              Suppressed once a verdict exists — see the bundle read, which
              already drops it; this guard covers the optimistic window. */}
            {check.prediction && reviewable && !activeReview && (
              <ProposalCard
                open={proposalOpen}
                pending={reviewPending}
                proposal={check.prediction}
                onAdjudicate={handleAdjudicate}
                onConfirm={() => openReject(check.prediction ?? undefined)}
                onToggle={setProposalOpen}
              />
            )}
            {/* The verifier's account of what it saw. Clamping it to two lines
              hid the middle of the argument behind an ellipsis with no way to
              open it — in a detail view there is nothing to preview. */}
            {check.result?.toulmin?.evidence && (
              <Text fontSize={12} style={{ whiteSpace: 'pre-wrap' }} type={'secondary'}>
                {check.result.toulmin.evidence}
              </Text>
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
            {visualization && <VisualizationRenderer manifest={visualization} />}
            <EvidenceList
              evidence={check.evidence}
              overlays={commentOverlays}
              onReviewEvidence={canReview ? (id) => openReject(undefined, id) : undefined}
            />
            {staleThreads.length > 0 && (
              <Flexbox className={styles.staleRegions} gap={10}>
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.comments.historicalRegions', { count: staleThreads.length })}
                </Text>
                {staleThreads.map((thread) => {
                  const evidence = thread.root.evidenceId
                    ? evidenceById.get(thread.root.evidenceId)
                    : undefined;
                  return (
                    <Flexbox
                      horizontal
                      align={'flex-start'}
                      gap={12}
                      key={thread.root.id}
                      wrap={'wrap'}
                    >
                      {evidence && (
                        <ThreadEvidence
                          stale
                          comment={thread.root}
                          evidence={evidence}
                          roundIndex={
                            check.timeline.find((entry) =>
                              entry.evidence.some((item) => item.id === thread.root.evidenceId),
                            )?.roundIndex
                          }
                        />
                      )}
                      <Flexbox flex={1} style={{ minWidth: 200 }}>
                        <CommentThread
                          canComment={comments.canComment}
                          canResolve={canResolveThread(thread)}
                          thread={thread}
                          {...commentActions}
                        />
                      </Flexbox>
                    </Flexbox>
                  );
                })}
              </Flexbox>
            )}
            {check.state === 'not_executed' && (
              <Flexbox
                horizontal
                align={'center'}
                gap={8}
                paddingBlock={8}
                paddingInline={10}
                style={{
                  background: cssVar.colorFillQuaternary,
                  borderRadius: cssVar.borderRadius,
                  width: '100%',
                }}
              >
                <Icon
                  color={cssVar.colorTextQuaternary}
                  icon={CircleDashed}
                  size={15}
                  style={{ flex: 'none' }}
                />
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.focus.verifierDescription.notExecuted')}
                </Text>
              </Flexbox>
            )}

            {/* The verifier's record slot. An LLM judge's whole product IS its
              reasoning, so when it exists it IS the record shown here — in the
              same slot the empty-evidence note otherwise occupies (the two are
              the same statement: "here is what the verifier left behind"). An
              executed check with neither still SAYS so — a silent blank under
              the verdict reads as a rendering bug, not as a fact. */}
            {check.state !== 'not_executed' &&
              check.result &&
              (check.result.toulmin?.reasoning ? (
                <Flexbox
                  gap={4}
                  paddingBlock={8}
                  paddingInline={10}
                  style={{
                    background: cssVar.colorFillQuaternary,
                    borderRadius: cssVar.borderRadius,
                    width: '100%',
                  }}
                >
                  <Text fontSize={11} type={'secondary'}>
                    {t('acceptance.checks.judgeReason')}
                  </Text>
                  <Text fontSize={12} style={{ whiteSpace: 'pre-wrap' }}>
                    {check.result.toulmin.reasoning}
                  </Text>
                </Flexbox>
              ) : !hasRenderableEvidence(check.evidence.length, visualization) ? (
                <Flexbox
                  paddingBlock={6}
                  paddingInline={10}
                  style={{
                    background: cssVar.colorFillQuaternary,
                    borderRadius: cssVar.borderRadius,
                    width: '100%',
                  }}
                >
                  <Text fontSize={12} type={'secondary'}>
                    {t('acceptance.evidence.empty')}
                  </Text>
                </Flexbox>
              ) : null)}

            {/* The user's standing feedback hangs right under the evidence it
              judges. BOTH verdicts keep an undo path — a mis-click is the most
              likely way either happens, and a send-back the user didn't mean
              otherwise costs a whole repair round to walk back. */}
            {activeReview &&
              (activeReview.action === 'accept' ? (
                <Flexbox horizontal align={'center'} gap={8}>
                  <AcceptedNote review={activeReview} />
                  {reviewable && (
                    <Button
                      disabled={reviewPending}
                      size={'small'}
                      type={'text'}
                      onClick={(event) => {
                        event.stopPropagation();
                        openReject();
                      }}
                    >
                      {t('acceptance.review.revertToReject')}
                    </Button>
                  )}
                </Flexbox>
              ) : activeReview.action === 'ignore' ? (
                <Flexbox horizontal align={'center'} gap={8}>
                  <IgnoredNote review={activeReview} />
                  {reviewable && (
                    <>
                      <Button
                        disabled={reviewPending}
                        size={'small'}
                        type={'text'}
                        onClick={(event) => {
                          event.stopPropagation();
                          openReject();
                        }}
                      >
                        {t('acceptance.review.revertToReject')}
                      </Button>
                      <Button
                        disabled={reviewPending && !accepting}
                        loading={accepting}
                        size={'small'}
                        type={'text'}
                        onClick={handleAccept}
                      >
                        {t('acceptance.review.revertToAccept')}
                      </Button>
                    </>
                  )}
                </Flexbox>
              ) : (
                <Flexbox gap={6}>
                  <FeedbackCard evidenceById={evidenceById} review={activeReview} />
                  {/* The mirror of the accept escape: take the send-back back.
                    A fresh accept supersedes the reject, so the check leaves
                    待修复 and the feedback drops out of the next round's input. */}
                  {reviewable && (
                    <Flexbox horizontal>
                      <Button
                        disabled={reviewPending && !accepting}
                        loading={accepting}
                        size={'small'}
                        type={'text'}
                        onClick={handleAccept}
                      >
                        {t('acceptance.review.revertToAccept')}
                      </Button>
                    </Flexbox>
                  )}
                </Flexbox>
              ))}

            {/* Circling the evidence belongs WITH the evidence, above the
              history — it is another way of looking at what was delivered,
              not a verdict. The rounds this check already went through then
              sit between that and the verdict buttons: context for the
              decision, never an appendix to one already made. */}
            {detailMode && reviewable && !activeReview && hasAnnotatableEvidence(check) && (
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
              <span
                className={styles.historyToggle}
                onClick={() => setHistoryOpen((open) => !open)}
              >
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
            {/* One row closes the check: looking harder on the left, deciding on
              the right. Circling the evidence is another way of reading what
              was delivered rather than a verdict, so it keeps its quiet text
              styling and the left edge — but it sits ON the same line as the
              buttons instead of stacking a half-empty row above them. */}
            {(canCommentEvidence || (reviewable && !activeReview && !detailMode)) && (
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                {canCommentEvidence ? (
                  <Button
                    outdent
                    icon={<Icon icon={MessageSquare} />}
                    type={'text'}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEvidenceComment();
                    }}
                  >
                    {t('acceptance.comments.commentEvidence')}
                  </Button>
                ) : (
                  <span />
                )}
                {reviewable && !activeReview && !detailMode && (
                  <Flexbox horizontal gap={4} justify={'flex-end'}>
                    <Button
                      disabled={reviewPending && !ignoring}
                      loading={ignoring}
                      size={'small'}
                      type={'text'}
                      onClick={handleIgnore}
                    >
                      {t('acceptance.review.ignore')}
                    </Button>
                    <Button
                      disabled={reviewPending}
                      size={'small'}
                      type={'text'}
                      onClick={(event) => {
                        event.stopPropagation();
                        openReject();
                      }}
                    >
                      {t('acceptance.review.reject')}
                    </Button>
                    <Button
                      disabled={reviewPending && !accepting}
                      icon={<Icon icon={Check} />}
                      loading={accepting}
                      size={'small'}
                      type={'fill'}
                      onClick={handleAccept}
                    >
                      {t('acceptance.review.accept')}
                    </Button>
                  </Flexbox>
                )}
              </Flexbox>
            )}
            {/* The phone keeps its own stacked shape: a comment box over two
              full-width buttons, which no single row can hold. */}
            {reviewable && !activeReview && detailMode && (
              <Flexbox gap={10} style={{ marginBlockStart: 6 }}>
                <TextArea
                  autoSize={{ maxRows: 8, minRows: 3 }}
                  placeholder={t('acceptance.review.detailPlaceholder')}
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                />
                <Flexbox horizontal gap={8}>
                  <Button
                    block
                    disabled={reviewPending || !reviewComment.trim()}
                    loading={rejecting}
                    size={'large'}
                    style={{ flex: 1 }}
                    onClick={handleReject}
                  >
                    {t('acceptance.review.reject')}
                  </Button>
                  <Button
                    block
                    disabled={reviewPending && !accepting}
                    icon={<Icon icon={Check} />}
                    loading={accepting}
                    size={'large'}
                    style={{ flex: 1 }}
                    type={'fill'}
                    onClick={handleAccept}
                  >
                    {t('acceptance.review.accept')}
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);
