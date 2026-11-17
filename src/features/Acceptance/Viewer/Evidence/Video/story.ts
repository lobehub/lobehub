import type { VerifyEvidenceChapter } from '@lobechat/types';

import { claimsOf, disputesClaim, stepsOf } from './videoTime';

type ClaimRef = Pick<VerifyEvidenceChapter, 'kind' | 'note' | 't'>;

export interface StoryNote {
  disputes?: ClaimRef;
  end?: number;
  key: number | string;
  start: number;
}

export interface StoryChapterEntry {
  id: string;
  label: string;
  time: number;
  type: 'chapter';
}

export interface StoryClaimEntry<N extends StoryNote = StoryNote> {
  claim: VerifyEvidenceChapter;
  dispute?: N;
  id: string;
  time: number;
  type: 'claim';
}

export interface StoryNoteEntry<N extends StoryNote = StoryNote> {
  id: string;
  index: number;
  note: N;
  time: number;
  type: 'note';
}

export type StoryEntry<N extends StoryNote = StoryNote> =
  StoryChapterEntry | StoryClaimEntry<N> | StoryNoteEntry<N>;

const RANK: Record<StoryEntry['type'], number> = { chapter: 0, claim: 1, note: 2 };

const SEEK_TOLERANCE = 1 / 60;

export const storyNoteId = (key: number | string) => `note-${key}`;

export const buildVideoStory = <N extends StoryNote>(
  chapters: VerifyEvidenceChapter[],
  notes: N[],
): StoryEntry<N>[] => {
  const unclaimed = [...notes];
  const takeDispute = (claim: VerifyEvidenceChapter) => {
    const at = unclaimed.findIndex((note) => disputesClaim(note.disputes, claim));
    return at === -1 ? undefined : unclaimed.splice(at, 1)[0];
  };

  const claims = claimsOf(chapters).map((claim, index): StoryClaimEntry<N> => ({
    claim,
    dispute: takeDispute(claim),
    id: `claim-${claim.kind}-${claim.t}-${index}`,
    time: claim.t,
    type: 'claim',
  }));
  const entries: StoryEntry<N>[] = [
    ...stepsOf(chapters).map((step, index): StoryChapterEntry => ({
      id: `chapter-${step.t}-${index}`,
      label: step.label ?? '',
      time: step.t,
      type: 'chapter',
    })),
    ...claims,
    ...unclaimed.map((note): StoryNoteEntry<N> => ({
      id: storyNoteId(note.key),
      index: 0,
      note,
      time: note.start,
      type: 'note',
    })),
  ];

  let index = 0;
  return entries
    .toSorted((a, b) => a.time - b.time || RANK[a.type] - RANK[b.type])
    .map((entry) => (entry.type === 'note' ? { ...entry, index: ++index } : entry));
};

export const activeStoryEntryId = (entries: StoryEntry[], time: number) =>
  entries.findLast((entry) => entry.type !== 'chapter' && entry.time <= time + SEEK_TOLERANCE)?.id;

const CAPTION_HOLD_SECONDS = 2;

export const storyEntryCaption = <N extends StoryNote>(
  entry: StoryEntry<N>,
  noteText: (note: N) => string | undefined,
) => {
  const text = () => {
    switch (entry.type) {
      case 'chapter': {
        return entry.label;
      }
      case 'claim': {
        return entry.claim.note;
      }
      case 'note': {
        return noteText(entry.note);
      }
    }
  };
  return text()?.trim() || undefined;
};

export const captionEntriesAt = <N extends StoryNote>(
  entries: StoryEntry<N>[],
  time: number,
  noteText: (note: N) => string | undefined,
): StoryEntry<N>[] => {
  const heldUntil = (entry: StoryEntry<N>) =>
    Math.max(entry.time + CAPTION_HOLD_SECONDS, entry.type === 'note' ? (entry.note.end ?? 0) : 0);
  const showing = entries.filter(
    (entry) =>
      time >= entry.time - SEEK_TOLERANCE &&
      time < heldUntil(entry) &&
      storyEntryCaption(entry, noteText) !== undefined,
  );
  const latest = Math.max(...showing.map((entry) => entry.time));
  return showing.filter((entry) => entry.time === latest);
};

export interface ScrubberSegment {
  end: number;
  label?: string;
  start: number;
}

export const toScrubberSegments = (
  chapters: VerifyEvidenceChapter[],
  duration: number,
): ScrubberSegment[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const starts = stepsOf(chapters)
    .filter((step) => step.t >= 0 && step.t < duration)
    .toSorted((a, b) => a.t - b.t)
    .filter((step, index, sorted) => index === 0 || step.t !== sorted[index - 1].t)
    .map((step): Omit<ScrubberSegment, 'end'> => ({ label: step.label, start: step.t }));
  if (starts[0]?.start !== 0) starts.unshift({ start: 0 });
  return starts.map((segment, index) => ({
    ...segment,
    end: starts[index + 1]?.start ?? duration,
  }));
};

const DEFAULT_SPAN_SECONDS = 1;

export const spanFromFrame = (start: number, playhead: number, duration: number) => ({
  end:
    playhead > start + SEEK_TOLERANCE ? playhead : Math.min(start + DEFAULT_SPAN_SECONDS, duration),
  start,
});
const PIN_CLUSTER_SPAN = 0.01;
const PIN_FAN_STEP_PX = 14;

export interface PinSlot {
  after: number;
  before: number;
  offset: number;
  percent: number;
}

export const fanOutPins = (
  pins: { id: string; time: number }[],
  duration: number,
): Map<string, PinSlot> => {
  const slots = new Map<string, PinSlot>();
  if (!Number.isFinite(duration) || duration <= 0) return slots;

  const clusters: { id: string; time: number }[][] = [];
  for (const pin of pins.toSorted((a, b) => a.time - b.time)) {
    const cluster = clusters.at(-1);
    if (cluster && (pin.time - cluster[0].time) / duration <= PIN_CLUSTER_SPAN) cluster.push(pin);
    else clusters.push([pin]);
  }

  for (const cluster of clusters) {
    const last = cluster.length - 1;
    const middle = cluster.reduce((sum, pin) => sum + pin.time, 0) / cluster.length;
    for (const [index, pin] of cluster.entries()) {
      slots.set(pin.id, {
        after: (last - index) * PIN_FAN_STEP_PX,
        before: index * PIN_FAN_STEP_PX,
        offset: (index - last / 2) * PIN_FAN_STEP_PX,
        percent: (middle / duration) * 100,
      });
    }
  }
  return slots;
};
