import { describe, expect, it } from 'vitest';

import type { AcceptanceCheck } from '../Checks/types';
import { canMarkEvidence } from './evidence';

const check = (...types: string[]) =>
  ({
    evidence: types.map((type, index) => ({ fileUrl: `f${index}`, id: `e${index}`, type })),
  }) as unknown as AcceptanceCheck;

describe('canMarkEvidence', () => {
  it('offers marking on a video-only check on desktop, where the video stage exists', () => {
    expect(canMarkEvidence(check('video'), true)).toBe(true);
  });

  // The phone reject modal drops videos, so the entry would open an empty stage.
  it('hides marking on a video-only check on a phone', () => {
    expect(canMarkEvidence(check('video'), false)).toBe(false);
    expect(canMarkEvidence(check('video', 'screenshot'), false)).toBe(true);
  });
});
