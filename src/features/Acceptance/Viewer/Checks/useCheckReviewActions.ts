import { readEvidenceChapters } from '@lobechat/const/verify';
import { useState } from 'react';

import { isRejectable } from '../Evidence/evidence';
import { openCheckRejectModal } from '../Review/CheckRejectModal';
import type { CheckProposal } from '../Review/proposal';
import { classifyProposalEdit } from '../Review/proposal';
import { shouldCollapseAfterReview } from './checkState';
import type {
  AcceptanceCheck,
  AcceptanceCheckReviewEntry,
  CheckReviewInput,
  ProposalDismissInput,
} from './types';

interface StoppableEvent {
  stopPropagation: () => void;
}

interface UseCheckReviewActionsParams {
  activeReview?: AcceptanceCheckReviewEntry;
  check: AcceptanceCheck;
  expanded: boolean;
  onDismissProposal?: (input: ProposalDismissInput) => Promise<void>;
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onToggle: () => void;
  refreshEvidenceUrl: Parameters<typeof openCheckRejectModal>[0]['refreshEvidenceUrl'];
  title: string;
}

export const useCheckReviewActions = ({
  activeReview,
  check,
  expanded,
  onDismissProposal,
  onReview,
  onToggle,
  refreshEvidenceUrl,
  title,
}: UseCheckReviewActionsParams) => {
  const [accepting, setAccepting] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reviewComment, setReviewComment] = useState('');

  // With `fromProposal` the modal opens prefilled with the model's note and
  // regions, and the submitted result is diffed against it so the signal
  // records WHICH part of the proposal was wrong.
  const openReject = (fromProposal?: CheckProposal, initialEvidenceId?: string) =>
    openCheckRejectModal({
      initialEvidenceId,
      previousAttachments:
        activeReview?.action === 'reject'
          ? activeReview.attachments
              ?.filter((item) => item.url)
              .map((item) => ({ id: item.id, name: item.name, url: item.url! }))
          : undefined,
      previousAnnotations: activeReview?.action === 'reject' ? activeReview.annotations : undefined,
      previousComment: activeReview?.action === 'reject' ? activeReview.comment : undefined,
      refreshEvidenceUrl,
      checkDescription: check.planItem?.description,
      checkTitle: `C${check.seq} · ${title}`,
      draftKey: `${check.result?.id ?? 'unexecuted'}:${check.id}`,
      evidence: check.evidence.filter(isRejectable).map((item) => ({
        chapters: item.type === 'video' ? readEvidenceChapters(item.metadata) : undefined,
        fileUrl: item.fileUrl!,
        id: item.id,
        type: item.type,
      })),
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

  // Dismissing a proposal is NOT a review of the check — the check stays
  // pending and the reviewer still has to judge it. Only the model's opinion
  // is being answered, so this writes the outcome without touching
  // `user_decision`.
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
  const handleAccept = async (event: StoppableEvent) => {
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

  const handleReject = async (event: StoppableEvent) => {
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

  const handleIgnore = async (event: StoppableEvent) => {
    event.stopPropagation();
    setIgnoring(true);
    const ok = await onReview({ action: 'ignore', checkItemIds: [check.id] });
    setIgnoring(false);
    if (shouldCollapseAfterReview(ok, expanded)) onToggle();
  };

  return {
    accepting,
    handleAccept,
    handleAdjudicate,
    handleIgnore,
    handleReject,
    ignoring,
    openReject,
    rejecting,
    reviewComment,
    setReviewComment,
  };
};

export type CheckReviewActions = ReturnType<typeof useCheckReviewActions>;
