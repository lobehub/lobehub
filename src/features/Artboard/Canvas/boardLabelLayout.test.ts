import { describe, expect, it } from 'vitest';

import {
  BOARD_LABEL_FONT,
  boardLabelLayout,
  boardLabelScale,
  recommendBadge,
  textWidth,
} from './boardLabelLayout';

describe('boardLabelScale', () => {
  it('follows the zoom and caps at 23px on screen', () => {
    expect(boardLabelScale(1, 400)! * BOARD_LABEL_FONT).toBeCloseTo(23);
    expect(boardLabelScale(3, 400)! * BOARD_LABEL_FONT).toBeCloseTo(23);
    expect(boardLabelScale(0.5, 400)! * BOARD_LABEL_FONT).toBeCloseTo(12.8, 1);
    expect(boardLabelScale(0.2, 400)! * BOARD_LABEL_FONT).toBeCloseTo(5.9, 1);
  });

  it('hides the row below 11% zoom or on a board narrower than 48 screen px', () => {
    expect(boardLabelScale(0.1, 4000)).toBeNull();
    expect(boardLabelScale(0.2, 200)).toBeNull();
    expect(boardLabelScale(0.2, 240)).not.toBeNull();
  });
});

describe('textWidth', () => {
  it('counts wide characters as a full em and others as about half', () => {
    expect(textWidth('ab', 10)).toBeCloseTo(11);
    expect(textWidth('评论', 10)).toBe(20);
  });
});

describe('boardLabelLayout', () => {
  const base = { lead: 0, recommended: true, tag: 70, title: 100, trail: 0 };

  it('shows the recommended tag when it fits beside the title', () => {
    expect(boardLabelLayout({ ...base, boardWidth: 400, k: 1 })).toMatchObject({
      badge: false,
      label: { mark: 'tag' },
    });
  });

  it('falls back to a star when only the title fits', () => {
    const scale = boardLabelScale(1, 200)!;
    const layout = boardLabelLayout({ ...base, boardWidth: 150 * scale, k: 1 });
    expect(layout).toMatchObject({ badge: false, label: { mark: 'star' } });
  });

  it('floats a badge on the board when the inline mark is too small to read', () => {
    expect(boardLabelLayout({ ...base, boardWidth: 1000, k: 0.28 })).toMatchObject({
      badge: true,
      label: { mark: 'none' },
    });
    expect(boardLabelLayout({ ...base, boardWidth: 1000, k: 0.05 })).toEqual({
      badge: true,
      label: null,
    });
  });

  it('never marks a board that is not recommended', () => {
    expect(boardLabelLayout({ ...base, boardWidth: 1000, k: 0.05, recommended: false })).toEqual({
      badge: false,
      label: null,
    });
  });

  it('makes the row as wide as the board on screen', () => {
    const layout = boardLabelLayout({ ...base, boardWidth: 400, k: 0.5 });
    expect(layout.label!.width * layout.label!.scale).toBeCloseTo(200);
  });
});

describe('recommendBadge', () => {
  it('shrinks on narrow boards and hides on tiny ones', () => {
    expect(recommendBadge(200)).toEqual({ icon: 11, inset: 8, size: 20 });
    expect(recommendBadge(50)).toEqual({ icon: 8, inset: 4, size: 14 });
    expect(recommendBadge(19)).toBeNull();
  });
});
