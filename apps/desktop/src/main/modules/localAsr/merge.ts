import type { LocalAsrTranscriptSegment } from '@lobechat/electron-client-ipc';

export interface DiarizationTurn {
  /** seconds */
  end: number;
  speaker: number;
  /** seconds */
  start: number;
}

/**
 * Attach a speaker to each ASR segment by largest time overlap with the diarization
 * turns, then renumber clusters by first appearance ("speaker_1", "speaker_2", …).
 * Clustering ids skip numbers (e.g. 1 / 2 / 4), which is meaningless to users.
 */
export const assignSpeakers = (
  segments: Omit<LocalAsrTranscriptSegment, 'speaker'>[],
  turns: DiarizationTurn[],
): { segments: LocalAsrTranscriptSegment[]; speakers: string[] } => {
  const labels = new Map<number, string>();
  const labelOf = (cluster: number) => {
    let label = labels.get(cluster);
    if (!label) {
      label = `speaker_${labels.size + 1}`;
      labels.set(cluster, label);
    }
    return label;
  };

  const result = segments.map((segment) => {
    const start = segment.startMs / 1000;
    const end = segment.endMs / 1000;
    const overlap = new Map<number, number>();
    let nearest: { distance: number; speaker: number } | undefined;

    for (const turn of turns) {
      const shared = Math.min(end, turn.end) - Math.max(start, turn.start);
      if (shared > 0) {
        overlap.set(turn.speaker, (overlap.get(turn.speaker) ?? 0) + shared);
      } else {
        const distance = turn.start >= end ? turn.start - end : start - turn.end;
        if (!nearest || distance < nearest.distance) nearest = { distance, speaker: turn.speaker };
      }
    }

    let speaker: number | undefined;
    let best = 0;
    for (const [cluster, shared] of overlap) {
      if (shared > best) {
        best = shared;
        speaker = cluster;
      }
    }
    speaker ??= nearest?.speaker;

    return speaker === undefined ? { ...segment } : { ...segment, speaker: labelOf(speaker) };
  });

  return { segments: result, speakers: [...labels.values()] };
};
