import { describe, expect, it } from 'vitest';

import { GROUP_LABEL_FONT, groupChip, groupLabelScale, roundOrder } from './groupLabel';

describe('groupLabelScale', () => {
  it('follows the zoom with a softer curve and caps at 27px on screen', () => {
    expect(groupLabelScale(1)! * GROUP_LABEL_FONT).toBeCloseTo(27);
    expect(groupLabelScale(2)! * GROUP_LABEL_FONT).toBeCloseTo(27);
    expect(groupLabelScale(0.5)! * GROUP_LABEL_FONT).toBeCloseTo(16.6, 1);
    expect(groupLabelScale(0.3)! * GROUP_LABEL_FONT).toBeCloseTo(11.6, 1);
  });

  it('stays inside the band above the boards', () => {
    expect(groupLabelScale(0.1)).toBeCloseTo((144 * 0.1) / 46);
    expect(groupLabelScale(1, 48)).toBeCloseTo(48 / 46);
  });

  it('hides a label that would be unreadable', () => {
    expect(groupLabelScale(0.05)).toBeNull();
    expect(groupLabelScale(0.04)).toBeNull();
    expect(groupLabelScale(0.5, 4)).toBeNull();
  });
});

describe('roundOrder', () => {
  it('numbers the rounds of a page in order', () => {
    const order = roundOrder(
      [
        { id: 'a', pageId: 'p1' },
        { id: 'b', pageId: 'p2' },
        { id: 'c', pageId: 'p1' },
      ],
      'p1',
    );
    expect(order).toEqual({ a: 1, c: 2 });
  });
});

describe('groupChip', () => {
  it('marks a finalized journey with a lock, a round with its question number, and nothing else', () => {
    expect(groupChip({ locked: true, roundNumber: 2 })).toEqual({ kind: 'lock' });
    expect(groupChip({ locked: false, roundNumber: 2 })).toEqual({ kind: 'text', text: 'Q2' });
    expect(groupChip({ locked: false })).toBeNull();
  });
});
