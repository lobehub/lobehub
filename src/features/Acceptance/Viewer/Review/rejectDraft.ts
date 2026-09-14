import type { AcceptanceReviewAnnotation } from '@lobechat/types';

import type { PendingAttachment } from '../Evidence/attachments';

/** One annotatable evidence image (already filtered to visual, file-backed). */
export interface RejectableEvidence {
  fileUrl: string;
  id: string;
}

export interface DraftAnnotationEntry {
  comment: string;
  evidenceId: string;
  /** Stable identity — rapid move/resize updates must never key off object
      identity, which a stale render closure invalidates mid-gesture. */
  key: number;
  rect: AcceptanceReviewAnnotation['rect'];
}

/** What survives a refresh — typed feedback is too costly to lose to one F5. */
export interface RejectDraft {
  annotations: DraftAnnotationEntry[];
  attachments?: PendingAttachment[];
  comment: string;
}

let draftAnnotationSeq = 0;

export const nextAnnotationKey = () => ++draftAnnotationSeq;

export const serializeReviewAnnotations = (
  annotations: DraftAnnotationEntry[],
): AcceptanceReviewAnnotation[] =>
  annotations.map(({ comment, evidenceId, rect }) => ({
    comment: comment.trim() || undefined,
    evidenceId,
    rect,
  }));

/**
 * Regions to open the modal with, keyed for editing.
 *
 * Only regions whose evidence still exists are restored — a new round may have
 * replaced the artifacts since the draft was written, and a rect normalized
 * against an image that is gone would land on whatever took its place.
 */
export const restoreDraftAnnotations = (
  source: AcceptanceReviewAnnotation[],
  evidence: RejectableEvidence[],
): DraftAnnotationEntry[] =>
  source
    .filter((entry) => evidence.some((item) => item.id === entry.evidenceId))
    .map((entry) => ({
      comment: entry.comment ?? '',
      evidenceId: entry.evidenceId,
      key: nextAnnotationKey(),
      rect: entry.rect,
    }));

const draftStorageKey = (key: string) => `acceptance-reject-draft:${key}`;

export const readDraft = (key: string | undefined): RejectDraft | null => {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(draftStorageKey(key));
    return raw ? (JSON.parse(raw) as RejectDraft) : null;
  } catch {
    return null;
  }
};

/** An empty draft cleans its slot up rather than persisting a blank record. */
export const writeDraft = (key: string, draft: RejectDraft) => {
  try {
    if (
      !draft.comment &&
      draft.annotations.length === 0 &&
      (draft.attachments?.length ?? 0) === 0
    ) {
      localStorage.removeItem(draftStorageKey(key));
    } else {
      localStorage.setItem(draftStorageKey(key), JSON.stringify(draft));
    }
  } catch {
    /* quota/private mode — the draft is a convenience, never a blocker */
  }
};

export const clearDraft = (key: string) => {
  try {
    localStorage.removeItem(draftStorageKey(key));
  } catch {
    /* see writeDraft */
  }
};

export const mergeRejectComments = (initialComment = '', storedComment = '') => {
  const initial = initialComment.trim();
  const stored = storedComment.trim();
  if (!initial) return stored;
  if (!stored || stored === initial) return initial;
  return `${initial}\n\n${stored}`;
};

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Step one notch along ZOOM_STEPS, clamped at both ends. */
export const nextZoom = (current: number, direction: 1 | -1) => {
  const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
  const at = index === -1 ? 2 : index;
  return ZOOM_STEPS[Math.min(Math.max(at + direction, 0), ZOOM_STEPS.length - 1)];
};
