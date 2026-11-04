import { describe, expect, it } from 'vitest';

import { keyAction, nextOpen, nextSelection, reviewGrid } from './review';

const item = (key: string, state: string) => ({ key, state });

describe('nextOpen', () => {
  const items = [
    item('a', 'passed'),
    item('b', 'todo'),
    item('c', 'reworked'),
    item('d', 'waiting-agent'),
    item('e', 'changed'),
  ];

  it('moves to the next item that still needs the reviewer', () => {
    expect(nextOpen(items, 'b')).toBe('e');
  });

  it('wraps around and returns undefined when nothing is left', () => {
    expect(nextOpen(items, 'e')).toBe('b');
    expect(nextOpen([item('a', 'passed')], 'a')).toBeUndefined();
  });

  it('starts from the first open item without a current one', () => {
    expect(nextOpen(items, undefined)).toBe('b');
  });
});

describe('nextSelection', () => {
  it('leaves nothing selected once every item is handled, so the completion state shows', () => {
    expect(nextSelection([item('a', 'passed'), item('b', 'reworked')], 'b')).toBeUndefined();
    expect(nextSelection([item('a', 'passed')], undefined)).toBeUndefined();
    expect(nextSelection([item('a', 'passed'), item('b', 'todo')], 'a')).toBe('b');
  });
});

describe('keyAction', () => {
  it('maps J K Y N outside text inputs', () => {
    expect(keyAction('j', false)).toBe('next');
    expect(keyAction('k', false)).toBe('previous');
    expect(keyAction('y', false)).toBe('pass');
    expect(keyAction('n', false)).toBe('rework');
    expect(keyAction('x', false)).toBeUndefined();
  });

  it('ignores every shortcut while the reviewer is typing', () => {
    for (const key of ['j', 'k', 'y', 'n']) expect(keyAction(key, true)).toBeUndefined();
  });
});

describe('reviewGrid', () => {
  const conditions = [
    'light/375/default',
    'light/1280/default',
    'light/1280/hover-target',
    'dark/1280/default',
    'dark/375/default',
    'light/1280/default/rtl',
  ];
  const combos = [
    { index: 0, label: 'online：否' },
    { index: 1, label: 'online：是' },
  ];

  it('uses theme columns at the default width and combo rows', () => {
    const grid = reviewGrid(combos, conditions, [
      { combo: 1, condition: 'light/1280/default', summary: ['边框 无 → 1px solid'] },
    ]);
    expect(grid.columns.map((column) => column.label)).toEqual([
      'light/1280/default',
      'dark/1280/default',
    ]);
    expect(grid.rows[1].cells[0]).toMatchObject({
      differs: true,
      summary: ['边框 无 → 1px solid'],
    });
    expect(grid.rows[0].cells[0].differs).toBe(false);
  });

  it('counts the other conditions and lists only the ones that differ', () => {
    const grid = reviewGrid(combos, conditions, [
      { combo: 0, condition: 'light/375/default', summary: ['间距 0px → 8px'] },
    ]);
    expect(grid.restCount).toBe(8);
    expect(grid.restDifferences).toEqual([
      {
        combo: 0,
        condition: 'light/375/default',
        label: 'online：否',
        summary: ['间距 0px → 8px'],
      },
    ]);
  });

  it('falls back to the widest width when 1280 is absent', () => {
    const grid = reviewGrid(
      [{ index: 0, label: '默认' }],
      ['light/375/default', 'light/991/default'],
      [],
    );
    expect(grid.columns.map((column) => column.label)).toEqual(['light/991/default']);
  });
});
