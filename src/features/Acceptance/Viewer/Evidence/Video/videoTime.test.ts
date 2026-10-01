import type { VerifyEvidenceChapter } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  claimAt,
  claimsAt,
  disputesClaim,
  formatVideoClock,
  formatVideoTime,
  frameOf,
  isOnFrame,
  stepAt,
  steppedTime,
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

  it('steps exactly one frame at a time without drifting', () => {
    let time = 0;
    for (let i = 0; i < 90; i += 1) time = steppedTime(time, 1, 15);
    expect(frameOf(time)).toBe(90);
    expect(frameOf(steppedTime(time, -1, 15))).toBe(89);
    expect(steppedTime(14.99, 5, 15)).toBe(15);
    expect(steppedTime(0, -1, 15)).toBe(0);
  });

  it('names the step the playhead is in', () => {
    expect(stepAt(chapters, 6.5)?.label).toBe('Scroll #3');
    expect(stepAt(chapters, 5.9)?.label).toBe('Open');
  });

  it('captions a claim from its frame for two seconds, the newest one winning', () => {
    expect(claimAt(chapters, 6.9)).toBeUndefined();
    expect(claimAt(chapters, 7)?.kind).toBe('flag');
    expect(claimAt(chapters, 8)?.kind).toBe('check');
    expect(claimAt(chapters, 9.95)).toBeUndefined();
  });

  it('keeps a paused region on its own frame only', () => {
    expect(isOnFrame(7.2, 7.2, true)).toBe(true);
    expect(isOnFrame(7.2, 7.2 + 1 / 30, true)).toBe(false);
    expect(isOnFrame(7.2, 7.4, false)).toBe(true);
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

describe('claimsAt', () => {
  // The caption is where claims are disputed; one hiding another could never be.
  it('captions every claim that shares the frame, not just the last one', () => {
    const sameFrame = [
      { kind: 'check' as const, note: 'no skeleton', t: 7.9 },
      { kind: 'check' as const, note: 'first question in place', t: 7.9 },
      { kind: 'flag' as const, note: 'count 0 → 1', t: 7 },
    ];

    expect(claimsAt(sameFrame, 8).map((claim) => claim.note)).toEqual([
      'no skeleton',
      'first question in place',
    ]);
    expect(claimsAt(sameFrame, 7.2).map((claim) => claim.note)).toEqual(['count 0 → 1']);
    expect(claimsAt(sameFrame, 12)).toEqual([]);
  });
});
