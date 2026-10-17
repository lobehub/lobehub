import { describe, expect, it } from 'vitest';

import { createTombstones } from './tombstones';

describe('createTombstones', () => {
  it('tracks keys per scope, so a scope switch keeps each identity guarded', () => {
    const tombstones = createTombstones();
    tombstones.add('user-1:personal', 'a');
    tombstones.add('user-2:personal', 'a');

    expect(tombstones.has('user-1:personal', 'a')).toBe(true);
    expect(tombstones.has('user-2:personal', 'a')).toBe(true);
    expect(tombstones.has('user-1:personal', 'b')).toBe(false);
  });

  it('is idempotent and drops an emptied scope bucket', () => {
    const tombstones = createTombstones();
    tombstones.add('s', 'a');
    tombstones.add('s', 'a');
    expect(tombstones.size()).toBe(1);

    tombstones.clear('s', 'a');
    expect(tombstones.size()).toBe(0);
    expect(tombstones.has('s', 'a')).toBe(false);
  });

  it('bounds the tracked keys, evicting the oldest first', () => {
    const tombstones = createTombstones(3);
    for (const key of ['a', 'b', 'c', 'd']) tombstones.add('s', key);

    // A long-lived session that visits more subjects than the cap must not keep
    // growing: the oldest keys fall out first.
    expect(tombstones.size()).toBe(3);
    expect(tombstones.has('s', 'a')).toBe(false);
    expect(tombstones.has('s', 'd')).toBe(true);
  });

  it('does not evict when re-adding an already-tracked key', () => {
    const tombstones = createTombstones(2);
    tombstones.add('s', 'a');
    tombstones.add('s', 'a');
    tombstones.add('s', 'b');

    expect(tombstones.size()).toBe(2);
    expect(tombstones.has('s', 'a')).toBe(true);
    expect(tombstones.has('s', 'b')).toBe(true);
  });
});
