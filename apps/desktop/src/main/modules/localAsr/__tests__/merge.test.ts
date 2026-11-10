import { describe, expect, it } from 'vitest';

import { assignSpeakers } from '../merge';

describe('assignSpeakers', () => {
  it('picks the speaker with the largest overlap and renumbers by first appearance', () => {
    const { segments, speakers } = assignSpeakers(
      [
        { endMs: 4000, id: 'seg-1', startMs: 0, text: 'a' },
        { endMs: 9000, id: 'seg-2', startMs: 5000, text: 'b' },
        { endMs: 12_000, id: 'seg-3', startMs: 9500, text: 'c' },
      ],
      [
        { end: 4.2, speaker: 4, start: 0 },
        { end: 5.5, speaker: 2, start: 4.2 },
        { end: 9.2, speaker: 1, start: 5.5 },
        { end: 12, speaker: 4, start: 9.2 },
      ],
    );

    expect(segments.map((segment) => segment.speaker)).toEqual([
      'speaker_1',
      'speaker_2',
      'speaker_1',
    ]);
    expect(speakers).toEqual(['speaker_1', 'speaker_2']);
  });

  it('falls back to the nearest turn when a segment overlaps none', () => {
    const { segments } = assignSpeakers(
      [{ endMs: 2000, id: 'seg-1', startMs: 1000, text: 'a' }],
      [{ end: 5, speaker: 7, start: 2.1 }],
    );
    expect(segments[0].speaker).toBe('speaker_1');
  });

  it('leaves segments without speaker when diarization found nothing', () => {
    const { segments, speakers } = assignSpeakers(
      [{ endMs: 2000, id: 'seg-1', startMs: 1000, text: 'a' }],
      [],
    );
    expect(segments[0].speaker).toBeUndefined();
    expect(speakers).toEqual([]);
  });
});
