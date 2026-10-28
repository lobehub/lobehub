import type { VerifyEvidenceChapter, VerifyEvidenceChapterKind } from '@lobechat/types';
import type { VideoMarker, VideoSection } from '@lobehub/ui';

import { claimsOf, stepsOf } from './videoTime';

const MARKER_COLOR: Record<Exclude<VerifyEvidenceChapterKind, 'step'>, VideoMarker['color']> = {
  check: 'success',
  flag: 'warning',
};

export interface ClaimMarker extends VideoMarker {
  claim: VerifyEvidenceChapter;
}

export interface TimedNote {
  color?: string;
  comment?: string;
  end?: number;
  key: number | string;
  start: number;
}

export const toSections = (chapters: VerifyEvidenceChapter[]): VideoSection[] =>
  stepsOf(chapters).map((step) => ({ start: step.t, title: step.label ?? '' }));

export const toClaimMarkers = (
  chapters: VerifyEvidenceChapter[],
  label: (kind: VerifyEvidenceChapterKind) => string,
): ClaimMarker[] =>
  claimsOf(chapters).map((claim, index) => ({
    claim,
    color: MARKER_COLOR[claim.kind as keyof typeof MARKER_COLOR],
    content: claim.note,
    key: `claim-${claim.kind}-${claim.t}-${index}`,
    label: label(claim.kind),
    time: claim.t,
  }));

// Notes carry only a label: the hover preview names them, the caption stays for claims.
export const toNoteMarkers = (notes: TimedNote[]): VideoMarker[] =>
  notes.map((note) => ({
    color: note.color ?? 'error',
    key: `note-${note.key}`,
    label: note.comment,
    time: note.start,
  }));

export const noteKeyOf = (marker: VideoMarker) =>
  typeof marker.key === 'string' && marker.key.startsWith('note-')
    ? marker.key.slice('note-'.length)
    : undefined;
