import { describe, expect, it } from 'vitest';

import { type NavItem } from '@/hooks/useNavLayout';

import { resolveHeaderItems } from './headerItems';

const item = (key: string, extra: Partial<NavItem> = {}): NavItem => ({
  icon: null,
  key,
  title: key,
  ...extra,
});

describe('resolveHeaderItems', () => {
  it('moves Search out of the rows into the header', () => {
    const { rows, search } = resolveHeaderItems([item('search'), item('home'), item('tasks')]);

    expect(search?.key).toBe('search');
    expect(rows.map((row) => row.key)).toEqual(['home']);
  });

  it('drops hidden items', () => {
    const { rows, search } = resolveHeaderItems([
      item('search', { hidden: true }),
      item('home', { hidden: true }),
    ]);

    expect(search).toBeUndefined();
    expect(rows).toEqual([]);
  });
});
