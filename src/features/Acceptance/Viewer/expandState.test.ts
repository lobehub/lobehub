import { describe, expect, it } from 'vitest';

import { setAggregateEntry } from './expandState';

describe('setAggregateEntry', () => {
  // P2 regression: writing one aggregate's set must not wipe another's, so
  // switching acceptances in the portal and returning keeps each one's toggles.
  it('keeps each aggregate’s set isolated', () => {
    let map = new Map<string, Set<string>>();
    map = setAggregateEntry(map, 'A', new Set(['a1']));
    map = setAggregateEntry(map, 'B', new Set(['b1']));

    expect([...(map.get('A') ?? [])]).toEqual(['a1']);
    expect([...(map.get('B') ?? [])]).toEqual(['b1']);
  });

  it('applies updater functions against the current aggregate entry', () => {
    let map = new Map<string, Set<string>>([['A', new Set(['a1'])]]);
    map = setAggregateEntry(map, 'A', (prev) => new Set(prev).add('a2'));

    expect([...(map.get('A') ?? [])].sort()).toEqual(['a1', 'a2']);
  });

  it('returns the same map reference when the value is unchanged', () => {
    const same = new Set(['x']);
    const map = new Map<string, Set<string>>([['A', same]]);

    expect(setAggregateEntry(map, 'A', same)).toBe(map);
  });

  it('treats a missing id as its own bucket', () => {
    const map = setAggregateEntry(new Map(), undefined, new Set(['x']));
    expect([...(map.get('') ?? [])]).toEqual(['x']);
  });
});
