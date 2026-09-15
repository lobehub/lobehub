'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';

import type { PendingAttachment } from '../Evidence/attachments';
import { useFeedbackAttachments } from '../Evidence/attachments';
import type { MobileReviewEvent, MobileReviewStep } from '../Evidence/mobileReviewFlow';
import { nextMobileReviewStep } from '../Evidence/mobileReviewFlow';
import type { DraftAnnotationEntry, RejectableEvidence } from './rejectDraft';
import {
  clearDraft,
  mergeRejectComments,
  nextAnnotationKey,
  nextZoom,
  readDraft,
  restoreDraftAnnotations,
  serializeReviewAnnotations,
  writeDraft,
} from './rejectDraft';
import { canDismissRejectModal } from './rejectModalShell';
import { useReviewSubmit } from './useReviewSubmit';

const MAX_ATTACHMENTS = 6;

export interface RejectReviewInput {
  /** Stable key (the check id) for the refresh-surviving draft cache. */
  draftKey?: string;
  evidence: RejectableEvidence[];
  /**
   * Regions to open with — set when confirming a model proposal, so the
   * reviewer edits the model's boxes instead of redrawing them. Any stored
   * draft is ignored in that case: the proposal is the newer starting point.
   */
  initialAnnotations?: AcceptanceReviewAnnotation[];
  /** Feedback already typed in the focused detail before opening annotation. */
  initialComment?: string;
  initialEvidenceId?: string;
  /** Perform the reject; resolve true to close, false to stay open. */
  onConfirm: (value: {
    annotations: AcceptanceReviewAnnotation[];
    comment: string;
    fileIds: string[];
  }) => Promise<boolean>;
  previousAnnotations?: AcceptanceReviewAnnotation[];
  previousAttachments?: PendingAttachment[];
  previousComment?: string;
}

/**
 * Everything a reject is made of, independent of how it is laid out.
 *
 * The phone and the desktop draw this review very differently, but they must
 * never disagree about what a submittable reject IS — so the draft, the
 * regions, the attachments and the submit rule live here, once, and each
 * presentation only decides where to put them.
 */
export const useRejectReview = ({
  draftKey,
  evidence,
  initialAnnotations,
  initialComment,
  initialEvidenceId,
  onConfirm,
  previousAnnotations,
  previousAttachments,
  previousComment,
}: RejectReviewInput) => {
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [draft] = useState(() => readDraft(draftKey));
  const { failed, loading, submit } = useReviewSubmit();

  // Marking or panning — the phone review has no second screen to be on.
  const [step, setStep] = useState<MobileReviewStep>('browse');
  const advance = (event: MobileReviewEvent) =>
    setStep((current) => nextMobileReviewStep(current, event));

  const [comment, setComment] = useState(() =>
    // A proposal supersedes the stored draft rather than merging with it —
    // splicing the model's sentence into half-typed notes would produce
    // feedback neither party wrote.
    initialAnnotations?.length
      ? (initialComment ?? '')
      : mergeRejectComments(initialComment, draft?.comment ?? previousComment),
  );
  const [activeEvidenceId, setActiveEvidenceId] = useState(initialEvidenceId ?? evidence[0]?.id);
  const [annotations, setAnnotations] = useState<DraftAnnotationEntry[]>(() =>
    restoreDraftAnnotations(
      initialAnnotations?.length
        ? initialAnnotations
        : (draft?.annotations ?? previousAnnotations ?? []),
      evidence,
    ),
  );
  const [zoom, setZoom] = useState(1);

  // Your own screenshots (paste or upload) — attached to the reject alongside
  // the note and any circled regions.
  const { attachments, fileIds, handlePaste, remove, uploadFiles, uploading } =
    useFeedbackAttachments(MAX_ATTACHMENTS, draft?.attachments ?? previousAttachments);

  useEffect(() => {
    setCanDismissByClickOutside(canDismissRejectModal(loading));
  }, [loading, setCanDismissByClickOutside]);

  useEffect(() => {
    if (draftKey) writeDraft(draftKey, { annotations, attachments, comment });
  }, [annotations, attachments, comment, draftKey]);

  const activeIndex = evidence.findIndex((item) => item.id === activeEvidenceId);
  const activeEvidence = evidence.find((item) => item.id === activeEvidenceId);
  const activeAnnotations = annotations.filter((item) => item.evidenceId === activeEvidenceId);

  const selectEvidence = (index: number) => {
    if (!evidence[index]) return;
    setActiveEvidenceId(evidence[index].id);
    setZoom(1);
  };

  // The reject IS its feedback — at least one note (global or per-region) or
  // an attached screenshot the next round can act on.
  const canSubmit =
    Boolean(comment.trim()) ||
    annotations.some((annotation) => annotation.comment.trim()) ||
    fileIds.length > 0;

  return {
    activeAnnotations,
    activeEvidence,
    activeIndex,
    advance,
    annotations,
    attachments,
    canSubmit: canSubmit && !uploading,
    close,
    comment,
    drawing: step === 'draw',
    evidence,
    failed,
    hasEvidence: evidence.length > 0,
    loading,
    uploading,
    zoom,

    canvas: {
      onDraw: (rect: AcceptanceReviewAnnotation['rect']) => {
        setAnnotations((previous) => [
          ...previous,
          { comment: '', evidenceId: activeEvidence!.id, key: nextAnnotationKey(), rect },
        ]);
        advance('region-drawn');
      },
      /** The canvas indexes within the ACTIVE image; the store keys by region. */
      onRemove: (index: number) => {
        const target = activeAnnotations[index];
        if (target)
          setAnnotations((previous) => previous.filter((item) => item.key !== target.key));
      },
      onUpdate: (index: number, rect: AcceptanceReviewAnnotation['rect']) => {
        const target = activeAnnotations[index];
        if (target)
          setAnnotations((previous) =>
            previous.map((item) => (item.key === target.key ? { ...item, rect } : item)),
          );
      },
    },

    editAnnotation: (key: number, value: string) =>
      setAnnotations((previous) =>
        previous.map((item) => (item.key === key ? { ...item, comment: value } : item)),
      ),
    handlePaste,
    jumpToRegion: (evidenceId: string) => {
      selectEvidence(evidence.findIndex((item) => item.id === evidenceId));
      advance('edit-region');
    },
    removeAnnotation: (key: number) =>
      setAnnotations((previous) => previous.filter((item) => item.key !== key)),
    removeAttachment: remove,
    selectEvidence,
    setComment,
    stepZoom: (direction: 1 | -1) => setZoom((current) => nextZoom(current, direction)),
    submitReject: async () => {
      const confirmed = await submit(() =>
        onConfirm({
          annotations: serializeReviewAnnotations(annotations),
          comment: comment.trim(),
          fileIds,
        }),
      );
      if (confirmed) {
        if (draftKey) clearDraft(draftKey);
        close();
      }
    },
    uploadFiles,
  };
};

export type RejectReviewModel = ReturnType<typeof useRejectReview>;
