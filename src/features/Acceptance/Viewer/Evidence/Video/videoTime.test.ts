import type { VerifyEvidenceChapter } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  claimsOf,
  disputesClaim,
  formatVideoClock,
  formatVideoTime,
  isOnFrame,
  stepsOf,
} from './videoTime';

const chapters: VerifyEvidenceChapter[] = [
  { kind: 'step', label: 'Open', t: 0 },
  { kind: 'step', label: 'Scroll #3', t: 6 },
  { kind: 'flag', note: 'request count 0 → 1', t: 7 },
  { kind: 'check', note: 'no skeleton', t: 7.9 },
];

describe('video time', () => {
  it('formats to the hundredth, and chapter chips to the second', () => {
    expect(formatVideoTime(7.2)).toBe('0:07.20');
    expect(formatVideoTime(66.75)).toBe('1:06.75');
    expect(formatVideoTime(Number.NaN)).toBe('0:00.00');
    expect(formatVideoClock(12.5)).toBe('0:12');
  });

  it('keeps a paused region on its own frame only', () => {
    expect(isOnFrame(7.2, 7.2, true)).toBe(true);
    expect(isOnFrame(7.2, 7.2 + 1 / 30, true)).toBe(false);
    expect(isOnFrame(7.2, 7.4, false)).toBe(true);
  });
});

describe('chapters', () => {
  it('splits steps from the claims a reviewer audits', () => {
    expect(stepsOf(chapters).map((step) => step.label)).toEqual(['Open', 'Scroll #3']);
    expect(claimsOf(chapters).map((claim) => claim.kind)).toEqual(['flag', 'check']);
  });
});

describe('disputesClaim', () => {
  // Two self-checks can share a frame; disputing one must not settle the other.
  it('tells apart two claims of the same kind on the same frame', () => {
    const first = { kind: 'check' as const, note: 'no skeleton', t: 7.9 };
    const second = { kind: 'check' as const, note: 'first question in place', t: 7.9 };

    expect(disputesClaim(first, first)).toBe(true);
    expect(disputesClaim(first, second)).toBe(false);
    expect(disputesClaim(undefined, first)).toBe(false);
  });
});
