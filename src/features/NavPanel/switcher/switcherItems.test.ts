import { describe, expect, it } from 'vitest';

import {
  filterSwitcherItems,
  pickRecentItems,
  type SwitcherItem,
  touchRecentId,
} from './switcherItems';

const item = (id: string, title = id): SwitcherItem => ({ id, title });

describe('touchRecentId', () => {
  it('prepends a new id and drops older overflow', () => {
    expect(touchRecentId(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('moves an existing id to the front', () => {
    expect(touchRecentId(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('ignores an empty id', () => {
    expect(touchRecentId(['a'], '')).toEqual(['a']);
  });
});

describe('pickRecentItems', () => {
  const items = [item('a', 'Alpha'), item('b', 'Beta'), item('c', 'Gamma')];

  it('resolves ids that still exist, in recency order', () => {
    expect(pickRecentItems(['c', 'missing', 'a'], items)).toEqual([
      item('c', 'Gamma'),
      item('a', 'Alpha'),
    ]);
  });

  it('skips the active id and respects the limit', () => {
    expect(pickRecentItems(['a', 'b', 'c'], items, { excludeId: 'a', limit: 1 })).toEqual([
      item('b', 'Beta'),
    ]);
  });
});

describe('filterSwitcherItems', () => {
  const items = [item('1', 'Lobe AI'), item('2', 'Writing'), item('3', 'Research')];

  it('returns all items when the query is blank', () => {
    expect(filterSwitcherItems(items, '  ')).toEqual(items);
  });

  it('matches titles case-insensitively', () => {
    expect(filterSwitcherItems(items, 'wr')).toEqual([item('2', 'Writing')]);
  });

  it('matches secondary titles case-insensitively', () => {
    const roleItem = { id: '4', subtitle: 'Claude Code', title: 'Little C' };

    expect(filterSwitcherItems([...items, roleItem], 'claude')).toEqual([roleItem]);
  });
});
