import { describe, expect, it } from 'vitest';

import { restoreDraftAnnotations, serializeReviewAnnotations } from './rejectDraft';

const rect = { height: 0.2, width: 0.3, x: 0.1, y: 0.1 };
const whole = { height: 1, width: 1, x: 0, y: 0 };

describe('reject draft annotations', () => {
  it('keeps the frame, the span and the disputed claim of a video note through a round trip', () => {
    const evidence = [{ fileUrl: 'clip.mp4', id: 'video', type: 'video' }];
    const disputes = { kind: 'check' as const, note: 'no skeleton', t: 7.9 };
    const restored = restoreDraftAnnotations(
      [
        { comment: 'skeleton', evidenceId: 'video', rect, time: { start: 7.2 } },
        { evidenceId: 'video', rect: whole, time: { end: 7.6, start: 6.8 } },
        {
          comment: 'flashed earlier',
          disputes,
          evidenceId: 'video',
          rect: whole,
          time: { start: 7.9 },
        },
      ],
      evidence,
    );

    expect(serializeReviewAnnotations(restored)).toEqual([
      { comment: 'skeleton', evidenceId: 'video', rect, time: { start: 7.2 } },
      { comment: undefined, evidenceId: 'video', rect: whole, time: { end: 7.6, start: 6.8 } },
      {
        comment: 'flashed earlier',
        disputes,
        evidenceId: 'video',
        rect: whole,
        time: { start: 7.9 },
      },
    ]);
  });

  it('leaves an image note without a time key', () => {
    const [serialized] = serializeReviewAnnotations(
      restoreDraftAnnotations(
        [{ comment: ' faint ', evidenceId: 'shot', rect }],
        [{ fileUrl: 'a.png', id: 'shot' }],
      ),
    );
    expect(serialized).toEqual({ comment: 'faint', evidenceId: 'shot', rect });
    expect('time' in serialized).toBe(false);
  });
});
