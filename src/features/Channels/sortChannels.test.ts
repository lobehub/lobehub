import { describe, expect, it } from 'vitest';

import { sortChannels } from './sortChannels';

const channel = (id: string, title: string, createdAt: string, updatedAt?: string) => ({
  createdAt: new Date(createdAt),
  id,
  title,
  updatedAt: updatedAt ? new Date(updatedAt) : undefined,
});

const channels = [
  channel('a', 'Beta', '2026-01-02', '2026-03-01'),
  channel('b', 'alpha', '2026-01-03'),
  channel('c', 'Gamma', '2026-01-01', '2026-02-01'),
];

const ids = (list: { id: string }[]) => list.map((item) => item.id);

describe('sortChannels', () => {
  it('orders by creation time in both directions', () => {
    expect(ids(sortChannels(channels, { by: 'createdAt', order: 'desc' }))).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(ids(sortChannels(channels, { by: 'createdAt', order: 'asc' }))).toEqual(['c', 'a', 'b']);
  });

  it('orders by activity, falling back to creation time for a Channel never updated', () => {
    expect(ids(sortChannels(channels, { by: 'updatedAt', order: 'desc' }))).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(ids(sortChannels(channels, { by: 'updatedAt', order: 'asc' }))).toEqual(['b', 'c', 'a']);
  });

  it('orders by name ignoring case', () => {
    expect(ids(sortChannels(channels, { by: 'title', order: 'asc' }))).toEqual(['b', 'a', 'c']);
    expect(ids(sortChannels(channels, { by: 'title', order: 'desc' }))).toEqual(['c', 'a', 'b']);
  });

  it('leaves the input untouched', () => {
    const before = ids(channels);
    sortChannels(channels, { by: 'title', order: 'asc' });
    expect(ids(channels)).toEqual(before);
  });
});
