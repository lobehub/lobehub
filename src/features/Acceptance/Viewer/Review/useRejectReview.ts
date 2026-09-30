'use client';

import { FULL_FRAME_RECT } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { useModalContext } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';

import type { PendingAttachment } from '../Evidence/attachments';
import { useFeedbackAttachments } from '../Evidence/attachments';
import type { MobileReviewEvent, MobileReviewStep } from '../Evidence/mobileReviewFlow';
import { nextMobileReviewStep } from '../Evidence/mobileReviewFlow';
import type { DraftAnnotationEntry, RejectableEvidence } from './rejectDraft';
import {
  clampZoom,
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
  /**
   * Evidence this layout cannot edit (videos on a phone). Its annotations are
   * restored and submitted untouched — a reject replaces the whole decision
   * detail, so dropping them here would silently delete that feedback.
   */
  keptEvidence?: RejectableEvidence[];
  /** Perform the reject; resolve true to close, false to stay open. */
  onConfirm: (value: {
    annotations: AcceptanceReviewAnnotation[];
    comment: string;
    fileIds: string[];
  }) => Promise<boolean>;
  previousAnnotations?: AcceptanceReviewAnnotation[];
  previousAttachments?: PendingAttachment[];
  previousComment?: string;
  /** A freshly signed URL for one evidence, for recovering an expired video. */
  refreshEvidenceUrl?: (evidenceId: string) => Promise<string | undefined>;
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
  keptEvidence = [],
  onConfirm,
  previousAnnotations,
  previousAttachments,
  previousComment,
  refreshEvidenceUrl,
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
      [...evidence, ...keptEvidence],
    ),
  );
  const [zoom, setZoom] = useState(1);
  /** The video note being written — its frame is highlighted on the timeline. */
  const [activeNoteKey, setActiveNoteKey] = useState<number>();

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
  /** The notes this layout can show and edit; kept ones ride along unseen. */
  const editableAnnotations = annotations.filter((item) =>
    evidence.some((entry) => entry.id === item.evidenceId),
  );

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
    editableAnnotations,
    refreshEvidenceUrl,
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

    activeNoteKey,
    /**
     * A note on the active video: a region on one frame, a whole frame, or a
     * span. A note without a region covers the whole frame. Returns its key so
     * the stage can focus the note that was just made.
     */
    addVideoNote: (note: {
      disputes?: AcceptanceReviewAnnotation['disputes'];
      rect?: AcceptanceReviewAnnotation['rect'];
      time: NonNullable<AcceptanceReviewAnnotation['time']>;
    }) => {
      const key = nextAnnotationKey();
      setAnnotations((previous) => [
        ...previous,
        {
          comment: '',
          disputes: note.disputes,
          evidenceId: activeEvidence!.id,
          key,
          rect: note.rect ?? { ...FULL_FRAME_RECT },
          time: note.time,
        },
      ]);
      setActiveNoteKey(key);
      return key;
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
    setActiveNoteKey,
    removeAnnotation: (key: number) =>
      setAnnotations((previous) => previous.filter((item) => item.key !== key)),
    removeAttachment: remove,
    selectEvidence,
    setComment,
    /** A pinch lands anywhere in range; the buttons still step by notches from there. */
    setZoom: (value: number) => setZoom(clampZoom(value)),
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
