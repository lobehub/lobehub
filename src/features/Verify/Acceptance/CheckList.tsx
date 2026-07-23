'use client';

import type { AcceptanceGroupFeedback, AcceptanceReviewAnnotation } from '@lobechat/types';
import {
  ActionIcon,
  copyToClipboard,
  Empty,
  Flexbox,
  Icon,
  Image,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  BadgeCheck,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDashed,
  FileText,
  Film,
  HelpCircle,
  Images,
  MessageSquareText,
  MessageSquareX,
  PartyPopper,
  Repeat,
  XCircle,
} from 'lucide-react';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import {
  EvidenceComparisonCard,
  readEvidenceComparison,
} from '../components/EvidenceComparisonCard';
import {
  CollapsibleMarkdownEvidence,
  EvidenceFileCard,
  markdownTextEvidenceTypes,
} from '../components/MarkdownEvidence';
import { AnnotatedImage } from './Annotation';
import { AttachmentThumbs } from './attachments';
import { openCheckRejectModal } from './CheckRejectModal';
import { openGroupFeedbackModal } from './modals';

export type AcceptanceCheck = AcceptanceBundle['checks'][number];
export type AcceptanceCheckState = AcceptanceCheck['state'];
type AcceptanceEvidence = AcceptanceCheck['evidence'][number];
type AcceptanceCheckReviewEntry = AcceptanceCheck['reviews'][number];

/** What the user asked the page to record — the page owns the service call. */
export interface CheckReviewInput {
  action: 'accept' | 'reject';
  annotations?: AcceptanceReviewAnnotation[];
  checkItemIds: string[];
  comment?: string;
  fileIds?: string[];
}

/** The user's standing verdict on a check — `pending` means "awaiting your confirmation". */
export type UserReviewState = 'accepted' | 'pending' | 'rejected';

export const userReviewState = (check: AcceptanceCheck): UserReviewState => {
  const review = check.userReview;
  if (!review) return 'pending';
  if (review.action === 'accept') return 'accepted';
  return review.stale ? 'pending' : 'rejected';
};

/** Every reviewable check in the group is user-accepted — settled business. */
export const isGroupFullyAccepted = (checks: AcceptanceCheck[]): boolean => {
  const reviewable = checks.filter((check) => check.result);
  return (
    reviewable.length > 0 && reviewable.every((check) => userReviewState(check) === 'accepted')
  );
};

/** Unresolved-first ordering — exceptions are what the decision hinges on. */
const SEVERITY: Record<AcceptanceCheckState, number> = {
  failed: 0,
  not_executed: 2,
  passed: 3,
  uncertain: 1,
};

/**
 * Verdict iconography: a bare check for passed (no ring), doubling into a
 * bare double-check once the human signs it off — one icon slot, read like a
 * delivery receipt. Non-passed states keep their ringed marks.
 */
const STATE_META: Record<AcceptanceCheckState, { color: string; icon: typeof Check }> = {
  failed: { color: cssVar.colorError, icon: XCircle },
  not_executed: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  passed: { color: cssVar.colorSuccess, icon: Check },
  uncertain: { color: cssVar.colorWarning, icon: HelpCircle },
};

export const isException = (check: AcceptanceCheck) =>
  check.state === 'failed' || check.state === 'uncertain';

const VISUAL_EVIDENCE = new Set(['gif', 'screenshot', 'video']);

const isVisual = (item: AcceptanceEvidence) =>
  Boolean(item.fileUrl) && VISUAL_EVIDENCE.has(item.type);

export const hasVisualEvidence = (check: AcceptanceCheck) => check.evidence.some(isVisual);

const styles = createStaticStyles(({ css }) => ({
  caption: css`
    align-self: center;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  chip: css`
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  chipClickable: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  descClamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  evidenceImage: css`
    overflow: hidden;

    width: fit-content;
    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  evidenceText: css`
    overflow: auto;

    max-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  emptyCard: css`
    padding-block: 48px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  // The finish-line icon pops in — a small beat of delight the plain empty
  // state never earned. Plays once, on the transition into the celebration.
  celebrateIcon: css`
    @keyframes acceptance-celebrate-pop {
      0% {
        transform: scale(0.6);
        opacity: 0;
      }

      60% {
        transform: scale(1.15);
      }

      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    animation: acceptance-celebrate-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  `,
  groupCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  groupHeader: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 16px;
    background: ${cssVar.colorFillQuaternary};

    .acceptance-group-actions {
      opacity: 0;
      transition: opacity 0.2s;
    }

    &:hover {
      .acceptance-group-actions {
        opacity: 1;
      }
    }
  `,
  historyToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  row: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  /** Stable check label ("C3") — referenced by feedback and annotations. */
  seqChip: css`
    flex: none;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    letter-spacing: 0.02em;
  `,
  seqChipClickable: css`
    cursor: copy;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  rowActions: css`
    opacity: 0;
    transition: opacity 0.2s;
  `,
  rowHeader: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;

    &:hover {
      .acceptance-row-actions {
        opacity: 1;
      }
    }

    /* The hover wash marks the collapsed row as a click target. An OPEN row is
       in reading mode — a gray band flashing between the white body and the
       white page just severs the title from its content, so no wash there. */
    &:not([data-expanded]):hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  stepDot: css`
    flex: none;

    width: 9px;
    height: 9px;
    margin-block-start: 5px;
    border: 2px solid;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,
  stepRail: css`
    flex: 1;
    width: 1px;
    margin-block-start: 6px;
    background: ${cssVar.colorBorderSecondary};
  `,
  titleEllipsis: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/** Evidence media counts for the collapsed row's right-side badges. */
const evidenceCounts = (evidence: AcceptanceEvidence[]) => {
  const counts = { file: 0, image: 0, video: 0 };
  for (const item of evidence) {
    if (item.type === 'video' && item.fileUrl) counts.video += 1;
    else if (isVisual(item)) counts.image += 1;
    else counts.file += 1;
  }
  return counts;
};

const EVIDENCE_BADGES = [
  { icon: Images, key: 'image', labelKey: 'acceptance.evidence.image' },
  { icon: Film, key: 'video', labelKey: 'acceptance.evidence.video' },
  { icon: FileText, key: 'file', labelKey: 'acceptance.evidence.file' },
] as const;

/** A filename is not a caption — only descriptive text renders under the artifact. */
const isFilename = (value: string | null | undefined) =>
  !value ||
  /^[\w.-]+\.(?:gif|html?|jpe?g|json|log|markdown|md|mp4|png|txt|webm|webp)$/i.test(value);

/**
 * Reserve the image's box before it loads — with the stored intrinsic size the
 * layout never jumps when a row expands and its screenshots stream in.
 */
const imageRatio = (item: AcceptanceEvidence): string | undefined =>
  item.fileWidth && item.fileHeight ? `${item.fileWidth} / ${item.fileHeight}` : undefined;

/** Flat media for a comparison side — the card frames it, so no own border/radius. */
const comparisonContent = (item: AcceptanceEvidence) =>
  item.type === 'video' ? (
    <video controls src={item.fileUrl!} style={{ display: 'block', width: '100%' }} />
  ) : (
    <Image
      preview
      alt={item.description ?? item.fileName ?? item.type}
      loading={'lazy'}
      src={item.fileUrl!}
      style={{ aspectRatio: imageRatio(item), borderRadius: 0, width: '100%' }}
      variant={'borderless'}
    />
  );

const EvidenceList = memo<{ evidence: AcceptanceEvidence[] }>(({ evidence }) => {
  const sorted = [...evidence].sort((a, b) => (isVisual(b) ? 1 : 0) - (isVisual(a) ? 1 : 0));
  if (sorted.length === 0) return null;

  // Before/after pairs render as one fused comparison card (same component as
  // the verify report). Only complete pairs fuse; a lone half stays a plain
  // artifact, matching the ingest CLI's warning semantics.
  const groups = new Map<string, Partial<Record<'after' | 'before', AcceptanceEvidence>>>();
  for (const item of sorted) {
    if (!isVisual(item)) continue;
    const comparison = readEvidenceComparison(item.metadata);
    if (!comparison) continue;
    const group = groups.get(comparison.id) ?? {};
    group[comparison.role] = item;
    groups.set(comparison.id, group);
  }
  const pairedIds = new Set(
    [...groups.values()]
      .filter((group) => group.before && group.after)
      .flatMap((group) => [group.before!.id, group.after!.id]),
  );

  const comparisonSide = (item: AcceptanceEvidence) => ({
    caption:
      readEvidenceComparison(item.metadata)?.label ??
      (isFilename(item.description) ? undefined : (item.description ?? undefined)),
    content: comparisonContent(item),
  });

  return (
    <Flexbox gap={12}>
      {sorted.map((item) => {
        if (pairedIds.has(item.id)) {
          const comparison = readEvidenceComparison(item.metadata)!;
          // The pair renders once, anchored at its `before` half.
          if (comparison.role !== 'before') return null;
          const group = groups.get(comparison.id)!;
          return (
            <EvidenceComparisonCard
              after={comparisonSide(group.after!)}
              before={comparisonSide(group.before!)}
              key={comparison.id}
              layout={comparison.layout}
            />
          );
        }

        const caption = !isFilename(item.description) && (
          <span className={styles.caption}>{item.description}</span>
        );
        if (item.fileUrl && item.type === 'video')
          return (
            <Flexbox gap={4} key={item.id} style={{ maxWidth: '100%', width: 'fit-content' }}>
              <video
                controls
                src={item.fileUrl}
                style={{ borderRadius: 8, maxHeight: 360, maxWidth: '100%', width: 'auto' }}
              />
              {caption}
            </Flexbox>
          );
        if (item.fileUrl && VISUAL_EVIDENCE.has(item.type))
          return (
            <Flexbox gap={4} key={item.id} style={{ maxWidth: '100%', width: 'fit-content' }}>
              {/* The frame owns the border — the inner Image must not draw its
                  own, or the two 1px borders stack visibly. The frame also
                  reserves the aspect ratio so the row's height is settled
                  before the image loads (no expand jump). */}
              <Flexbox
                className={styles.evidenceImage}
                style={
                  item.fileWidth && item.fileHeight
                    ? { aspectRatio: imageRatio(item), maxWidth: '100%', width: item.fileWidth }
                    : undefined
                }
              >
                <Image
                  alt={item.description ?? item.fileName ?? item.type}
                  loading={'lazy'}
                  src={item.fileUrl}
                  variant={'borderless'}
                  style={{
                    borderRadius: 0,
                    maxWidth: '100%',
                    // Fill the ratio-reserving frame; without known dimensions
                    // the image keeps its intrinsic size (legacy evidence).
                    width: item.fileWidth && item.fileHeight ? '100%' : undefined,
                  }}
                />
              </Flexbox>
              {caption}
            </Flexbox>
          );
        if (item.content && markdownTextEvidenceTypes.has(item.type))
          return (
            <Flexbox gap={4} key={item.id}>
              <CollapsibleMarkdownEvidence>{item.content}</CollapsibleMarkdownEvidence>
              {caption}
            </Flexbox>
          );
        if (item.content)
          return (
            <Flexbox gap={4} key={item.id}>
              <div className={styles.evidenceText}>{item.content}</div>
              {caption}
            </Flexbox>
          );
        if (item.fileUrl && markdownTextEvidenceTypes.has(item.type))
          return (
            <EvidenceFileCard
              markdown
              description={item.description}
              fileName={item.fileName}
              key={item.id}
              url={item.fileUrl}
            />
          );
        return null;
      })}
    </Flexbox>
  );
});

/**
 * The user's acceptance, rendered as one quiet gray line — a signature, not an
 * event card: the verdict icon stays the row's headline, this is metadata.
 */
const AcceptedNote = memo<{ review: AcceptanceCheckReviewEntry }>(({ review }) => {
  const { t } = useTranslation('verify');
  return (
    <Flexbox horizontal align={'center'} gap={6}>
      <Icon color={cssVar.colorTextQuaternary} icon={BadgeCheck} size={13} />
      <Text fontSize={12} type={'secondary'}>
        {t('acceptance.review.acceptedNote', {
          time: dayjs(review.createdAt).format('MM-DD HH:mm'),
        })}
      </Text>
    </Flexbox>
  );
});

/**
 * One reject-feedback event: a small red marker line, then the note and the
 * circled regions as plain content — no background wash. Used both as the
 * standing feedback under the row's evidence and inside the iteration history.
 */
const FeedbackCard = memo<{
  evidenceById: Map<string, AcceptanceEvidence>;
  review: AcceptanceCheckReviewEntry;
}>(({ evidenceById, review }) => {
  const { t } = useTranslation('verify');
  if (review.action === 'accept') return <AcceptedNote review={review} />;

  const groups = new Map<
    string,
    { comment?: string; rect: AcceptanceReviewAnnotation['rect'] }[]
  >();
  for (const annotation of review.annotations ?? []) {
    const bucket = groups.get(annotation.evidenceId) ?? [];
    bucket.push({ comment: annotation.comment, rect: annotation.rect });
    groups.set(annotation.evidenceId, bucket);
  }

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon color={cssVar.colorError} icon={MessageSquareX} size={13} />
        <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
          {t('acceptance.review.feedbackLabel')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {dayjs(review.createdAt).format('MM-DD HH:mm')}
        </Text>
      </Flexbox>
      {review.comment && <Text style={{ fontSize: 12 }}>{review.comment}</Text>}
      <AttachmentThumbs attachments={review.attachments} />
      {[...groups.entries()].map(([evidenceId, annotations]) => {
        const evidence = evidenceById.get(evidenceId);
        // The evidence may be gone (deleted round) — the notes stay readable.
        if (!evidence?.fileUrl)
          return annotations
            .filter((annotation) => annotation.comment)
            .map((annotation, index) => (
              <Text fontSize={12} key={`${evidenceId}-${index}`} type={'secondary'}>
                {annotation.comment}
              </Text>
            ));
        return (
          <AnnotatedImage
            annotations={annotations}
            key={evidenceId}
            src={evidence.fileUrl}
            imageStyle={{
              // Known dimensions reserve the box up front (explicit height +
              // ratio-derived width) — no height jump when the row expands
              // and the screenshot streams in.
              aspectRatio: imageRatio(evidence),
              height: evidence.fileHeight ? Math.min(evidence.fileHeight, 240) : undefined,
              maxHeight: 240,
            }}
          />
        );
      })}
    </Flexbox>
  );
});

/** Everything a check knows about its evidence, keyed by id — annotation lookups. */
const collectEvidenceById = (check: AcceptanceCheck): Map<string, AcceptanceEvidence> => {
  const map = new Map<string, AcceptanceEvidence>();
  for (const entry of check.timeline) for (const item of entry.evidence) map.set(item.id, item);
  for (const item of check.evidence) map.set(item.id, item);
  return map;
};

/** A step of the merged history: an executed round, or a user feedback event. */
type HistoryStep =
  | { key: string; kind: 'review'; review: AcceptanceCheckReviewEntry; roundIndex: number }
  | { key: string; kind: 'run'; roundIndex: number; step: AcceptanceCheck['timeline'][number] };

/**
 * The iteration-history timeline (newest first): each executed step's round,
 * the wording THAT round used, and its evidence — plus the user's feedback
 * events, slotted after the round they judged — how the check evolved.
 */
const IterationTimeline = memo<{
  check: AcceptanceCheck;
  evidenceById: Map<string, AcceptanceEvidence>;
  historyReviews: AcceptanceCheckReviewEntry[];
  onRound: (round: number) => void;
}>(({ check, evidenceById, historyReviews, onRound }) => {
  const { t } = useTranslation('verify');

  const merged: HistoryStep[] = [
    ...check.timeline.map<HistoryStep>((step) => ({
      key: `run-${step.roundIndex}-${step.resultId}`,
      kind: 'run',
      roundIndex: step.roundIndex,
      step,
    })),
    ...historyReviews.map<HistoryStep>((review) => ({
      key: `review-${review.id}`,
      kind: 'review',
      review,
      roundIndex: review.roundIndex,
    })),
  ]
    .sort(
      (a, b) =>
        a.roundIndex - b.roundIndex ||
        // Within a round the run comes first — feedback judges its result.
        (a.kind === 'review' ? 1 : 0) - (b.kind === 'review' ? 1 : 0) ||
        (a.kind === 'review' && b.kind === 'review'
          ? new Date(a.review.createdAt).getTime() - new Date(b.review.createdAt).getTime()
          : 0),
    )
    .reverse();

  return (
    <Flexbox>
      {merged.map((entry, index) => {
        const isCurrent = index === 0;
        const isLast = index === merged.length - 1;

        if (entry.kind === 'review')
          return (
            <Flexbox horizontal gap={12} key={entry.key}>
              <Flexbox align={'center'} style={{ flex: 'none', width: 9 }}>
                <span
                  className={styles.stepDot}
                  style={{
                    borderColor:
                      entry.review.action === 'accept' ? cssVar.colorSuccess : cssVar.colorError,
                  }}
                />
                {!isLast && <div className={styles.stepRail} />}
              </Flexbox>
              <Flexbox flex={1} gap={6} style={{ minWidth: 0, paddingBlockEnd: isLast ? 0 : 20 }}>
                <FeedbackCard evidenceById={evidenceById} review={entry.review} />
              </Flexbox>
            </Flexbox>
          );

        const { step } = entry;
        const stateColor =
          {
            failed: cssVar.colorError,
            passed: cssVar.colorSuccess,
            uncertain: cssVar.colorWarning,
          }[step.state as string] ?? cssVar.colorTextQuaternary;

        return (
          <Flexbox horizontal gap={12} key={entry.key}>
            <Flexbox align={'center'} style={{ flex: 'none', width: 9 }}>
              <span
                className={styles.stepDot}
                style={{
                  background: isCurrent ? stateColor : cssVar.colorBgContainer,
                  borderColor: isCurrent ? stateColor : cssVar.colorTextQuaternary,
                }}
              />
              {!isLast && <div className={styles.stepRail} />}
            </Flexbox>
            <Flexbox flex={1} gap={6} style={{ minWidth: 0, paddingBlockEnd: isLast ? 0 : 20 }}>
              <Tooltip title={t('acceptance.history.jump', { round: step.roundIndex })}>
                <Text
                  strong
                  style={{ cursor: 'pointer', fontSize: 12, lineHeight: '19px' }}
                  onClick={() => onRound(step.roundIndex)}
                >
                  {t('acceptance.round', { round: step.roundIndex })}
                </Text>
              </Tooltip>
              <Text style={{ fontSize: 12 }}>{step.title}</Text>
              {step.evidence.length > 0 && (
                <Flexbox horizontal gap={8} wrap={'wrap'}>
                  {step.evidence.map((item) =>
                    item.fileUrl && VISUAL_EVIDENCE.has(item.type) ? (
                      <Flexbox className={styles.evidenceImage} key={item.id}>
                        <Image
                          alt={item.description ?? item.type}
                          loading={'lazy'}
                          src={item.fileUrl}
                          style={{ borderRadius: 0, maxHeight: 160, maxWidth: 280, width: 'auto' }}
                          variant={'borderless'}
                        />
                      </Flexbox>
                    ) : item.content ? (
                      <div
                        className={styles.evidenceText}
                        key={item.id}
                        style={{ maxHeight: 120, maxWidth: 420 }}
                      >
                        {item.content}
                      </div>
                    ) : null,
                  )}
                </Flexbox>
              )}
            </Flexbox>
          </Flexbox>
        );
      })}
      {check.result?.suggestion && (
        <Flexbox horizontal gap={12} style={{ marginBlockStart: 12 }}>
          <Text fontSize={12} style={{ flex: 'none', minWidth: 64 }} type={'secondary'}>
            {t('acceptance.detail.suggestion')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {check.result.suggestion}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

const CheckRow = memo<{
  canReview: boolean;
  check: AcceptanceCheck;
  expanded: boolean;
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound: (round: number) => void;
  onToggle: () => void;
  reviewPending: boolean;
}>(({ canReview, check, expanded, onReview, onRound, onToggle, reviewPending }) => {
  const { t } = useTranslation('verify');
  // The judging narrative stays collapsed: level one is title + evidence.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seqCopied, setSeqCopied] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const meta = STATE_META[check.state];
  const counts = evidenceCounts(check.evidence);

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
  const hasHistory = check.revisions > 1 || historyReviews.length > 0;

  const openReject = () =>
    openCheckRejectModal({
      checkTitle: `C${check.seq} · ${check.title}`,
      draftKey: check.id,
      evidence: check.evidence
        .filter((item) => isVisual(item))
        .map((item) => ({ fileUrl: item.fileUrl!, id: item.id })),
      onConfirm: ({ annotations, comment, fileIds }) =>
        onReview({
          action: 'reject',
          annotations: annotations.length > 0 ? annotations : undefined,
          checkItemIds: [check.id],
          comment: comment || undefined,
          fileIds: fileIds.length > 0 ? fileIds : undefined,
        }),
    });

  // Accepting settles the check — the row folds itself away once the write
  // lands, so the reviewer's eye moves on to what still needs judgment.
  const handleAccept = async (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setAccepting(true);
    const ok = await onReview({ action: 'accept', checkItemIds: [check.id] });
    setAccepting(false);
    if (ok && expanded) onToggle();
  };

  // The user's standing verdict owns the head slot: a reject replaces the
  // verifier's mark outright (that check IS sent back, whatever the verifier
  // said); passed + user-accepted merges into the double-check receipt.
  const headIcon =
    reviewState === 'rejected'
      ? MessageSquareX
      : check.state === 'passed' && reviewState === 'accepted'
        ? CheckCheck
        : meta.icon;
  const headColor = reviewState === 'rejected' ? cssVar.colorError : meta.color;

  const headIconNode = (
    <Icon color={headColor} icon={headIcon} size={16} style={{ flex: 'none' }} />
  );

  return (
    <Flexbox className={styles.row} data-check-row={check.id}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.rowHeader}
        data-expanded={expanded ? '' : undefined}
        gap={10}
        onClick={onToggle}
      >
        {reviewState === 'rejected' ? (
          <Tooltip title={t('acceptance.review.rejectedHint')}>{headIconNode}</Tooltip>
        ) : (
          headIconNode
        )}
        <Tooltip title={seqCopied ? t('acceptance.checks.copied') : t('acceptance.checks.copySeq')}>
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
          flex={1}
          gap={8}
          style={{ minWidth: 0 }}
          wrap={expanded ? 'wrap' : 'nowrap'}
        >
          <Text
            className={expanded ? undefined : styles.titleEllipsis}
            style={{ fontSize: 13, minWidth: 0 }}
          >
            {check.title}
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
          {reviewable && reviewState === 'pending' && (
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
        <Flexbox horizontal align={'center'} gap={6}>
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
          {/* The iteration mark stays compact — [↻ N]; the words (verified N
              rounds · introduced in round X) live in its tooltip. Clicking
              jumps to the round the concern first appeared in. */}
          {check.revisions > 1 && (
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
          {check.resultRound !== undefined && check.resultRound !== null && (
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
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={ChevronRight}
            size={14}
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </Flexbox>
      </Flexbox>

      {expanded && (
        <Flexbox gap={10} paddingBlock={'0 14px'} paddingInline={16}>
          {check.result?.toulmin?.evidence && (
            <Text className={styles.descClamp} fontSize={12} type={'secondary'}>
              {check.result.toulmin.evidence}
            </Text>
          )}
          <EvidenceList evidence={check.evidence} />

          {/* An executed check with zero artifacts must SAY so — a silent blank
              under the verdict reads as a rendering bug, not as a fact. Filled
              so it reads as a status, never as more description text. */}
          {check.result && check.evidence.length === 0 && (
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
          )}

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

          {/* Confirm (plain filled) anchors the right edge; reject is the
              quiet text escape next to it. */}
          {reviewable && !activeReview && (
            <Flexbox horizontal gap={4} justify={'flex-end'}>
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

          {hasHistory && (
            <span className={styles.historyToggle} onClick={() => setHistoryOpen((open) => !open)}>
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
        </Flexbox>
      )}
    </Flexbox>
  );
});

/**
 * The filter maps the reviewer's WORKFLOW, not the verifier's taxonomy — each
 * tab is the user's own disposition on a check, so the verifier's verdict alone
 * never moves a check between tabs:
 * - pending (未验收):  awaiting your review — whatever the verifier returned
 *   (passed-but-unconfirmed, uncertain ❓, failed, or never executed). The row
 *   icon still carries the verifier verdict; the tab is about YOUR call.
 * - needsFix (待修复): you rejected it. The only bucket that is a decision you
 *   made — so every 待修复 item carries your feedback (待修复 stays in step with
 *   反馈, instead of inflating with checks you never sent back).
 * - accepted (已验收): you signed it off.
 *
 * An uncertain/failed check the verifier flagged but you have NOT rejected is
 * still 未验收: the verifier is unsure or the run is red, so it needs your eyes
 * — not an automatic "needs fix" label you never asked for.
 */
export type CheckFilter = 'all' | 'pending' | 'needsFix' | 'accepted';

export const checkFilterState = (check: AcceptanceCheck): Exclude<CheckFilter, 'all'> => {
  const review = userReviewState(check);
  if (review === 'accepted') return 'accepted';
  if (review === 'rejected') return 'needsFix';
  return 'pending';
};

interface CheckGroup {
  checks: AcceptanceCheck[];
  key: string;
  label: string;
}

/**
 * Group by the harness-authored business `category`. Product surfaces describe
 * where a check ran, not what user requirement it verifies, so they must never
 * become acceptance sections.
 */
export const groupChecks = (checks: AcceptanceCheck[], otherLabel: string): CheckGroup[] => {
  const groups = new Map<string, CheckGroup>();
  for (const check of checks) {
    const category = check.category?.trim();
    const key = category ? `category:${category}` : 'uncategorized';
    const label = category || otherLabel;
    const group = groups.get(key) ?? { checks: [], key, label };
    group.checks.push(check);
    groups.set(key, group);
  }
  return [...groups.values()];
};

interface CheckListProps {
  /** Whether the viewer may review checks (the aggregate's owner). */
  canReview: boolean;
  checks: AcceptanceCheck[];
  collapsedGroups: Set<string>;
  /** The latest round index — arbitrates group-feedback staleness. */
  currentRound: number;
  expanded: Set<string>;
  filter: CheckFilter;
  /** Group-scoped feedback entries recorded on the aggregate. */
  groupFeedback: AcceptanceGroupFeedback[];
  /** Record group-scoped feedback; resolves true when the write landed. */
  onGroupFeedback: (category: string, comment: string, fileIds: string[]) => Promise<boolean>;
  /** Record the user's verdict; resolves true when the write landed. */
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound: (round: number) => void;
  onToggleGroup: (key: string) => void;
  onToggleGroupItems: (ids: string[], open: boolean) => void;
  onToggleItem: (id: string) => void;
  reviewPending: boolean;
  /** Show only checks that round executed (any step of their timeline). */
  round?: number | null;
}

/** The union check list: one joined card, collapsible business groups. */
const CheckList = memo<CheckListProps>(
  ({
    canReview,
    checks,
    collapsedGroups,
    currentRound,
    expanded,
    filter,
    groupFeedback,
    onGroupFeedback,
    onReview,
    onRound,
    onToggleGroup,
    onToggleGroupItems,
    onToggleItem,
    reviewPending,
    round,
  }) => {
    const { t } = useTranslation('verify');
    const [acceptingGroup, setAcceptingGroup] = useState<string | null>(null);

    const visible = (check: AcceptanceCheck) =>
      (filter === 'all' || checkFilterState(check) === filter) &&
      (round === null ||
        round === undefined ||
        check.timeline.some((step) => step.roundIndex === round));

    const groups = groupChecks(checks, t('acceptance.group.uncategorized'))
      .map((group) => ({
        ...group,
        rows: group.checks
          .filter(visible)
          .sort(
            (a, b) =>
              SEVERITY[a.state] - SEVERITY[b.state] ||
              (hasVisualEvidence(b) ? 1 : 0) - (hasVisualEvidence(a) ? 1 : 0) ||
              a.introducedAtRound - b.introducedAtRound,
          ),
      }))
      .filter((group) => group.rows.length > 0);

    // A filter that matches nothing must read as "this bucket is empty", not as
    // a blank bordered card — each filter gets its own reassuring line. But an
    // EMPTY pending bucket where every check is signed off isn't "nothing here"
    // — it's the finish line, so it earns a celebration instead of a flat line.
    if (groups.length === 0) {
      const allAccepted = filter === 'pending' && isGroupFullyAccepted(checks);
      return (
        <Flexbox align={'center'} className={styles.emptyCard} gap={12} justify={'center'}>
          {allAccepted ? (
            <>
              <Icon
                className={styles.celebrateIcon}
                color={cssVar.colorSuccess}
                icon={PartyPopper}
                size={40}
              />
              <Flexbox align={'center'} gap={4}>
                <Text strong style={{ color: cssVar.colorSuccess, fontSize: 15 }}>
                  {t('acceptance.checks.allAccepted.title')}
                </Text>
                <Text fontSize={13} type={'secondary'}>
                  {t('acceptance.checks.allAccepted.desc')}
                </Text>
              </Flexbox>
            </>
          ) : (
            <Empty
              icon={CircleDashed}
              description={t(
                filter === 'all'
                  ? 'acceptance.checks.empty'
                  : `acceptance.checks.emptyFilter.${filter}`,
              )}
            />
          )}
        </Flexbox>
      );
    }

    return (
      <Flexbox className={styles.groupCard}>
        {groups.map(({ checks: groupChecks_, key, label, rows }, groupIndex) => {
          const passed = groupChecks_.filter((check) => check.state === 'passed').length;
          const collapsed = collapsedGroups.has(key);
          const anyItemOpen = rows.some((check) => expanded.has(check.id));
          // Only executed checks can be stamped — see the row-level gating.
          const reviewableChecks = groupChecks_.filter((check) => check.result);
          const unaccepted = reviewableChecks.filter(
            (check) => userReviewState(check) !== 'accepted',
          );
          // The header counts what the REVIEWER cares about: how many they
          // signed off, how many the verifier flagged, how many they sent
          // back — not the verifier's pass tally alone.
          const acceptedCount = reviewableChecks.filter(
            (check) => userReviewState(check) === 'accepted',
          ).length;
          const rejectedCount = reviewableChecks.filter(
            (check) => userReviewState(check) === 'rejected',
          ).length;
          const exceptionCount = groupChecks_.filter((check) => isException(check)).length;
          // Everything passed AND the user signed all of it off — the ratio
          // itself turns into the green receipt, no separate right-side note.
          const allVerified = passed === groupChecks_.length && isGroupFullyAccepted(groupChecks_);
          // Group-scoped feedback targets the raw category ('' = uncategorized).
          const rawCategory = key === 'uncategorized' ? '' : label;
          const feedbackEntries = groupFeedback.filter((entry) => entry.category === rawCategory);

          return (
            <Fragment key={key}>
              <Flexbox
                horizontal
                align={'center'}
                className={styles.groupHeader}
                gap={8}
                style={{
                  borderBlockStart:
                    groupIndex > 0 ? `1px solid ${cssVar.colorBorderSecondary}` : 'none',
                }}
                onClick={() => onToggleGroup(key)}
              >
                <Text strong style={{ fontSize: 13 }}>
                  {label}
                </Text>
                {allVerified ? (
                  <Flexbox
                    horizontal
                    align={'center'}
                    gap={4}
                    style={{ color: cssVar.colorSuccess, fontSize: 12 }}
                  >
                    <Icon icon={BadgeCheck} size={13} />
                    {t('acceptance.group.allVerified', { passed, total: groupChecks_.length })}
                  </Flexbox>
                ) : (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('acceptance.group.acceptedRatio', {
                        accepted: acceptedCount,
                        total: groupChecks_.length,
                      })}
                    </Text>
                    {exceptionCount > 0 && (
                      <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
                        {t('acceptance.group.failedCount', { count: exceptionCount })}
                      </Text>
                    )}
                    {rejectedCount > 0 && (
                      <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
                        {t('acceptance.group.rejectedCount', { count: rejectedCount })}
                      </Text>
                    )}
                  </Flexbox>
                )}
                {/* Bulk accept sits by the ratio it settles, hover-revealed —
                    a full-width column of always-on buttons begs misclicks. */}
                {canReview &&
                  reviewableChecks.length > 0 &&
                  (unaccepted.length > 0 ? (
                    <Button
                      className={'acceptance-group-actions'}
                      disabled={reviewPending && acceptingGroup !== key}
                      icon={<Icon icon={BadgeCheck} />}
                      loading={acceptingGroup === key}
                      size={'small'}
                      // The spinner must stay visible after the pointer leaves.
                      style={acceptingGroup === key ? { opacity: 1 } : undefined}
                      type={'text'}
                      onClick={async (event) => {
                        event.stopPropagation();
                        setAcceptingGroup(key);
                        const ok = await onReview({
                          action: 'accept',
                          checkItemIds: unaccepted.map((check) => check.id),
                        });
                        setAcceptingGroup(null);
                        // A fully signed-off group is settled business — fold it.
                        if (ok && !collapsed) onToggleGroup(key);
                      }}
                    >
                      {t('acceptance.review.acceptAll')}
                    </Button>
                  ) : allVerified ? null : (
                    // Fully signed off but not all green — the mixed-verdict
                    // receipt that can't fold into the ratio text.
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={4}
                      style={{ color: cssVar.colorSuccess, fontSize: 12 }}
                    >
                      <Icon icon={BadgeCheck} size={13} />
                      {t('acceptance.review.acceptAllDone')}
                    </Flexbox>
                  ))}
                <Flexbox flex={1} />
                {/* Group-scoped feedback — the channel for concerns that
                    belong to no single check yet must reach the next round.
                    Lives with the other group-level controls by the chevron. */}
                {canReview && (
                  <span className={'acceptance-group-actions'}>
                    <ActionIcon
                      icon={MessageSquareText}
                      size={'small'}
                      title={t('acceptance.group.feedbackAction')}
                      onClick={(event) => {
                        event.stopPropagation();
                        openGroupFeedbackModal({
                          groupLabel: label,
                          onConfirm: (comment, fileIds) =>
                            onGroupFeedback(rawCategory, comment, fileIds),
                        });
                      }}
                    />
                  </span>
                )}
                {collapsed ? (
                  // Fixed-size placeholder keeps the header height stable across toggles.
                  <div style={{ height: 24, width: 24 }} />
                ) : (
                  <ActionIcon
                    icon={anyItemOpen ? ChevronsDownUp : ChevronsUpDown}
                    size={'small'}
                    title={
                      anyItemOpen
                        ? t('acceptance.group.collapseItems')
                        : t('acceptance.group.expandItems')
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      // Expanding a group is "show me what still needs judgment"
                      // — rows the user already accepted are settled business
                      // and stay folded (they open individually on demand).
                      // Collapsing folds everything, accepted or not.
                      onToggleGroupItems(
                        anyItemOpen
                          ? rows.map((check) => check.id)
                          : rows
                              .filter((check) => userReviewState(check) !== 'accepted')
                              .map((check) => check.id),
                        !anyItemOpen,
                      );
                    }}
                  />
                )}
                <Icon
                  color={cssVar.colorTextQuaternary}
                  icon={ChevronRight}
                  size={14}
                  style={{
                    transform: collapsed ? 'none' : 'rotate(90deg)',
                    transition: 'transform 0.2s',
                  }}
                />
              </Flexbox>
              {/* Group feedback trail — newest first; entries consumed by a
                  later round stay readable but visually recede. */}
              {!collapsed && feedbackEntries.length > 0 && (
                <Flexbox gap={10} paddingBlock={10} paddingInline={16}>
                  {[...feedbackEntries].reverse().map((entry) => {
                    const stale = entry.roundIndex < currentRound;
                    return (
                      <Flexbox
                        gap={4}
                        key={`${entry.createdAt}-${entry.roundIndex}`}
                        style={stale ? { opacity: 0.55 } : undefined}
                      >
                        <Flexbox horizontal align={'center'} gap={6}>
                          <Icon
                            color={stale ? cssVar.colorTextQuaternary : cssVar.colorError}
                            icon={MessageSquareText}
                            size={13}
                          />
                          <Text
                            style={{
                              color: stale ? cssVar.colorTextTertiary : cssVar.colorError,
                              fontSize: 12,
                            }}
                          >
                            {t('acceptance.group.feedbackLabel')}
                          </Text>
                          <Text fontSize={12} type={'secondary'}>
                            {dayjs(entry.createdAt).format('MM-DD HH:mm')}
                          </Text>
                        </Flexbox>
                        <Text style={{ fontSize: 12 }}>{entry.comment}</Text>
                        <AttachmentThumbs attachments={entry.attachments} />
                      </Flexbox>
                    );
                  })}
                </Flexbox>
              )}
              {!collapsed &&
                rows.map((check) => (
                  <CheckRow
                    canReview={canReview}
                    check={check}
                    expanded={expanded.has(check.id)}
                    key={check.id}
                    reviewPending={reviewPending}
                    onReview={onReview}
                    onRound={onRound}
                    onToggle={() => onToggleItem(check.id)}
                  />
                ))}
              {/* Bottom escape hatch — after scrolling through the group's rows,
                  collapse it without travelling back to the header. Labeled:
                  a bare icon at this distance from the header reads as noise. */}
              {!collapsed && (
                <Flexbox
                  align={'center'}
                  paddingBlock={4}
                  style={{ borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}` }}
                >
                  <Button
                    icon={<Icon icon={ChevronsDownUp} />}
                    size={'small'}
                    // Quiet escape hatch — tertiary text, not a competing action.
                    style={{ color: cssVar.colorTextTertiary }}
                    type={'text'}
                    onClick={() => onToggleGroup(key)}
                  >
                    {t('acceptance.group.collapse', { label })}
                  </Button>
                </Flexbox>
              )}
            </Fragment>
          );
        })}
      </Flexbox>
    );
  },
);

CheckList.displayName = 'AcceptanceCheckList';

export default CheckList;
