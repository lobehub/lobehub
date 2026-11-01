import { describe, expect, it } from 'vitest';

import { renderAnnotationRegion } from './annotationRegion';

const rect = { height: 0.2, width: 0.5, x: 0.1, y: 0.3 };

describe('renderAnnotationRegion', () => {
  it('describes a circled screenshot region by frame and position', () => {
    expect(
      renderAnnotationRegion({ comment: 'too faint', evidenceId: 'ev', rect }, 'frame 2'),
    ).toBe('  circled on frame 2 at 10%,30% sized 50%×20%: too faint');
  });

  // The frame is never attached, so coordinates would describe a picture the
  // model cannot see; it gets the moment and the words, and is told why.
  it('places a video note in time without a region the model cannot see', () => {
    expect(
      renderAnnotationRegion({ comment: 'skeleton', evidenceId: 'ev', rect, time: { start: 7.2 } }),
    ).toBe(
      '  marked at 7.2s into the video (video frame not attached — judge from the note alone): skeleton',
    );
    expect(
      renderAnnotationRegion({
        evidenceId: 'ev',
        rect: { height: 1, width: 1, x: 0, y: 0 },
        time: { end: 7.65, start: 6.75 },
      }),
    ).toBe(
      '  marked from 6.75s to 7.65s of the video (video frame not attached — judge from the note alone): (no note)',
    );
  });

  it('quotes the agent claim the reviewer disputes', () => {
    expect(
      renderAnnotationRegion({
        comment: 'it flashed before this frame',
        disputes: { kind: 'check', note: 'no skeleton', t: 7.9 },
        evidenceId: 'ev',
        rect: { height: 1, width: 1, x: 0, y: 0 },
        time: { start: 7.9 },
      }),
    ).toBe(
      `  marked at 7.9s into the video (video frame not attached — judge from the note alone) (disputing the agent's check: "no skeleton"): it flashed before this frame`,
    );
  });
});
