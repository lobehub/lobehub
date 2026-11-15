import type { meetingService } from '@/services/meeting';

type MeetingDetailPayload = NonNullable<Awaited<ReturnType<typeof meetingService.detail>>>;

/** Transcript rows with speaker names resolved; tolerates a payload missing either list. */
export const toTranscriptSegments = ({
  segments,
  speakers,
}: Partial<Pick<MeetingDetailPayload, 'segments' | 'speakers'>>) => {
  const speakerLabel = new Map(
    (speakers ?? []).map((speaker) => [speaker.id, speaker.displayName || speaker.label]),
  );
  return (segments ?? []).map((segment) => ({
    endMs: segment.endMs,
    id: segment.id,
    seq: segment.seq,
    speaker: segment.speakerId ? speakerLabel.get(segment.speakerId) : undefined,
    startMs: segment.startMs,
    text: segment.text,
  }));
};
