import { cssVar } from '@lobehub/ui';

/** Distinct, theme-aware colors for speakers, in the order they first speak. */
const SPEAKER_COLORS = [
  cssVar.blue,
  cssVar.orange,
  cssVar.green,
  cssVar.purple,
  cssVar.cyan,
  cssVar.magenta,
  cssVar.gold,
  cssVar.volcano,
];

export interface SpeakerView {
  color: string;
  name: string;
}

interface SpeakerRow {
  displayName: string | null;
  id: string;
  label: string;
}

/**
 * Name and color of every speaker. A diarized label (`S1`, `A`) reads as
 * "Speaker 1" until the user names the speaker.
 */
export const buildSpeakerViews = (
  speakers: readonly SpeakerRow[],
  fallbackName: (index: number) => string,
): Map<string, SpeakerView> =>
  new Map(
    speakers.map((speaker, index) => [
      speaker.id,
      {
        color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
        name: speaker.displayName || fallbackName(index + 1),
      },
    ]),
  );
