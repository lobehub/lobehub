import { describe, expect, it } from 'vitest';

import {
  anchorProps,
  JUMP_MARGIN,
  jumpScrollTop,
  pickActiveAnchor,
  READING_LINE,
  sameAnchors,
} from './resultAnchors';

describe('pickActiveAnchor', () => {
  it('returns -1 when the page has no anchors', () => {
    expect(pickActiveAnchor([], READING_LINE, false)).toBe(-1);
  });

  it('keeps the first anchor active before any has reached the reading line', () => {
    expect(pickActiveAnchor([200, 600, 1200], READING_LINE, false)).toBe(0);
  });

  it('picks the last anchor whose top has passed the reading line', () => {
    expect(pickActiveAnchor([-900, -300, 80, 700], 100, false)).toBe(2);
  });

  it('picks the last anchor at the bottom of the page even if it starts lower', () => {
    expect(pickActiveAnchor([-900, -300, 80, 700], 100, true)).toBe(3);
  });
});

describe('jumpScrollTop', () => {
  it('leaves the section it jumped to at the jump margin', () => {
    expect(jumpScrollTop(400, 200, 4000)).toBe(400 + 200 - JUMP_MARGIN);
  });

  it('never scrolls past either end of the range', () => {
    expect(jumpScrollTop(10, 0, 4000)).toBe(0);
    expect(jumpScrollTop(5000, 0, 1000)).toBe(1000);
    expect(jumpScrollTop(100, 0, 0)).toBe(0);
  });
});

describe('a jump lands on the section that was clicked', () => {
  // The reading line must reach a section that sits at the jump margin, or a
  // section only a few rows high (验收标准 with a single criterion) hands the
  // highlight to the section after it — the r1 defect.
  it('keeps the short section the reader clicked on active', () => {
    expect(READING_LINE).toBeGreaterThanOrEqual(JUMP_MARGIN);

    const sectionHeight = 40;
    const landedTops = [JUMP_MARGIN, JUMP_MARGIN + sectionHeight, JUMP_MARGIN + 900];
    expect(pickActiveAnchor(landedTops, READING_LINE, false)).toBe(0);
  });
});

describe('sameAnchors', () => {
  it('compares ids and labels in order', () => {
    const anchors = [{ id: 'a', label: 'A', level: 0 as const }];
    expect(sameAnchors(anchors, [{ id: 'a', label: 'A', level: 0 }])).toBe(true);
    expect(sameAnchors(anchors, [{ id: 'a', label: 'B', level: 0 }])).toBe(false);
    expect(sameAnchors(anchors, [])).toBe(false);
  });
});

describe('anchorProps', () => {
  it('marks a section with its id, label and level', () => {
    expect(anchorProps('trail', 'Exploration', 1)).toEqual({
      'data-result-anchor': 'trail',
      'data-result-anchor-label': 'Exploration',
      'data-result-anchor-level': 1,
    });
  });

  it('marks a plain section as level 0', () => {
    expect(anchorProps('overview', 'Overview')['data-result-anchor-level']).toBe(0);
  });
});
