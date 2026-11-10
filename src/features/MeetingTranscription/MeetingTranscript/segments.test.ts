import { describe, expect, it } from 'vitest';

import { toTranscriptSegments } from './segments';

const segment = { endMs: 2000, id: 'seg-1', seq: 0, speakerId: 'spk-1', startMs: 0, text: 'hi' };

describe('toTranscriptSegments', () => {
  it('resolves speaker names, preferring the display name', () => {
    const rows = toTranscriptSegments({
      segments: [segment],
      speakers: [{ displayName: 'Alice', id: 'spk-1', label: 'S1' }],
    } as any);

    expect(rows).toEqual([
      { endMs: 2000, id: 'seg-1', seq: 0, speaker: 'Alice', startMs: 0, text: 'hi' },
    ]);
  });

  it('returns no rows when the payload omits segments', () => {
    expect(toTranscriptSegments({ speakers: [] } as any)).toEqual([]);
  });

  it('keeps segments unlabelled when the payload omits speakers', () => {
    expect(toTranscriptSegments({ segments: [segment] } as any)[0].speaker).toBeUndefined();
  });
});
