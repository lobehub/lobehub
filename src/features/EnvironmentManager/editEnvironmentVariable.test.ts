import { describe, expect, it } from 'vitest';

import { editEnvironmentVariable } from './editEnvironmentVariable';

describe('editEnvironmentVariable', () => {
  const entries: [string, string][] = [
    ['A', 'one'],
    ['B', 'two'],
  ];

  it.each([
    ['A', 'B'],
    ['B', 'A'],
  ])('rejects renaming %s to existing %s without losing either value', (from, to) => {
    expect(editEnvironmentVariable(entries, [to, 'changed'], from)).toBeUndefined();
    expect(Object.fromEntries(entries)).toEqual({ A: 'one', B: 'two' });
  });

  it('rejects adding a key that already exists', () => {
    expect(editEnvironmentVariable(entries, ['A', 'replacement'])).toBeUndefined();
    expect(Object.fromEntries(entries)).toEqual({ A: 'one', B: 'two' });
  });

  it('allows changing the value of the same key', () => {
    expect(editEnvironmentVariable(entries, ['A', 'changed'], 'A')).toEqual([
      ['A', 'changed'],
      ['B', 'two'],
    ]);
  });

  it('allows a new name and preserves the other entries', () => {
    expect(editEnvironmentVariable(entries, ['C', 'two'], 'B')).toEqual([
      ['A', 'one'],
      ['C', 'two'],
    ]);
  });

  it('appends a new key, including an empty value', () => {
    expect(editEnvironmentVariable(entries, ['C', ''])).toEqual([...entries, ['C', '']]);
  });
});
