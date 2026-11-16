import { describe, expect, it } from 'vitest';

import { applyPinnedOrder, parsePinnedOrder } from './pinnedOrder';

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('applyPinnedOrder', () => {
  it('follows the saved order', () => {
    expect(ids(applyPinnedOrder(rows('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('puts rows missing from the order first, keeping their incoming order', () => {
    expect(ids(applyPinnedOrder(rows('new2', 'b', 'new1', 'a'), ['a', 'b']))).toEqual([
      'new2',
      'new1',
      'a',
      'b',
    ]);
  });

  it('ignores ids that match no row and keeps the first of duplicates', () => {
    expect(ids(applyPinnedOrder(rows('a', 'b'), ['gone', 'b', 'a', 'b']))).toEqual(['b', 'a']);
  });

  it('returns the rows unchanged without an order', () => {
    const items = rows('a', 'b');
    expect(applyPinnedOrder(items, [])).toBe(items);
  });
});

describe('parsePinnedOrder', () => {
  it('keeps only string ids', () => {
    expect(parsePinnedOrder(['a', 1, null, 'b'])).toEqual(['a', 'b']);
  });

  it('treats anything but an array as no order', () => {
    expect(parsePinnedOrder(null)).toEqual([]);
    expect(parsePinnedOrder({ a: 1 })).toEqual([]);
    expect(parsePinnedOrder('a')).toEqual([]);
  });
});
