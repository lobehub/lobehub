import { describe, expect, it } from 'vitest';

import type { GutterLayoutEntry } from './layout';
import { gutterOverhangBottom, gutterOverhangTop, layoutGutterCards } from './layout';

const entry = (id: string, anchorTop: number, height = 100, order = 0): GutterLayoutEntry => ({
  anchorTop,
  height,
  id,
  order,
});

describe('layoutGutterCards', () => {
  it('leaves cards on their own line when they do not collide', () => {
    const tops = layoutGutterCards([entry('a', 0), entry('b', 400)], { gap: 8 });

    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(400);
  });

  it('pushes a colliding card below the one above it', () => {
    const tops = layoutGutterCards([entry('a', 0), entry('b', 20), entry('c', 40)], { gap: 8 });

    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(108);
    expect(tops.get('c')).toBe(216);
  });

  it('orders by anchor regardless of input order, then by document order', () => {
    const tops = layoutGutterCards(
      [entry('later', 20, 100, 2), entry('same-line', 20, 100, 1), entry('first', 0)],
      { gap: 8 },
    );

    expect(tops.get('first')).toBe(0);
    expect(tops.get('same-line')).toBe(108);
    expect(tops.get('later')).toBe(216);
  });

  it('never places a card above the gutter', () => {
    const tops = layoutGutterCards([entry('a', -30)], { gap: 8 });

    expect(tops.get('a')).toBe(0);
  });

  it('keeps the active card level with its run and moves neighbours away', () => {
    const tops = layoutGutterCards(
      [entry('a', 300), entry('b', 320), entry('c', 340), entry('d', 900)],
      { activeId: 'b', gap: 8 },
    );

    expect(tops.get('b')).toBe(320);
    expect(tops.get('a')).toBe(212);
    expect(tops.get('c')).toBe(428);
    expect(tops.get('d')).toBe(900);
  });

  it('pushes the cards above the active one past the top edge when they do not fit', () => {
    const tops = layoutGutterCards([entry('a', 0), entry('b', 20), entry('c', 40)], {
      activeId: 'c',
      gap: 8,
    });

    expect(tops.get('c')).toBe(40);
    expect(tops.get('b')).toBe(-68);
    expect(tops.get('a')).toBe(-176);
  });

  it('keeps the active card level when the cluster above fits exactly', () => {
    const tops = layoutGutterCards([entry('a', 0), entry('b', 108)], { activeId: 'b', gap: 8 });

    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(108);
  });

  it('ignores an active id that is not in the gutter', () => {
    const tops = layoutGutterCards([entry('a', 0), entry('b', 20)], { activeId: 'zzz', gap: 8 });

    expect(tops.get('a')).toBe(0);
    expect(tops.get('b')).toBe(108);
  });
});

describe('gutterOverhangBottom', () => {
  const base = { hostBottom: 600, paneContentHeight: 2000, paneViewportHeight: 600 };

  it('is zero while the stack ends within the document', () => {
    expect(gutterOverhangBottom({ ...base, stackBottom: 1900 })).toBe(0);
    expect(gutterOverhangBottom({ ...base, stackBottom: 2000 })).toBe(0);
  });

  it('measures exactly what the stack overhangs', () => {
    expect(gutterOverhangBottom({ ...base, stackBottom: 2250 })).toBe(250);
  });

  it('accounts for a panel that ends above the pane bottom', () => {
    // The panel's clip box ends 40px above the pane's bottom edge.
    expect(gutterOverhangBottom({ ...base, hostBottom: 560, stackBottom: 2000 })).toBe(40);
  });

  it('covers a document too short to scroll at all', () => {
    expect(
      gutterOverhangBottom({
        hostBottom: 600,
        paneContentHeight: 400,
        paneViewportHeight: 600,
        stackBottom: 900,
      }),
    ).toBe(300);
  });

  it('rounds up so a fractional overhang is fully revealed', () => {
    expect(gutterOverhangBottom({ ...base, stackBottom: 2000.25 })).toBe(1);
  });
});

describe('gutterOverhangTop', () => {
  it('is zero when every card sits inside the clip box', () => {
    const tops = new Map([
      ['a', 13],
      ['b', 200],
    ]);
    expect(gutterOverhangTop({ clipTop: 13, tops })).toBe(0);
    expect(gutterOverhangTop({ clipTop: 13, tops: new Map() })).toBe(0);
  });

  it('measures how far the highest card rises above the clip box', () => {
    const tops = new Map([
      ['a', -176],
      ['b', -68],
      ['c', 40],
    ]);
    expect(gutterOverhangTop({ clipTop: 0, tops })).toBe(176);
    expect(gutterOverhangTop({ clipTop: 13, tops: new Map([['a', 5]]) })).toBe(8);
  });

  it('rounds up so a fractional overhang is fully covered', () => {
    expect(gutterOverhangTop({ clipTop: 0, tops: new Map([['a', -0.25]]) })).toBe(1);
  });
});
