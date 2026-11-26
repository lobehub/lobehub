import { describe, expect, it } from 'vitest';

import { groupFilterOptions } from './groupFilterOptions';

describe('groupFilterOptions', () => {
  it('keeps ungrouped options top level and folds consecutive grouped ones into sections', () => {
    const options = [
      { value: 'none' },
      { value: 'self' },
      { group: 'Workspace members', value: 'u1' },
      { group: 'Workspace members', value: 'u2' },
      { group: 'Agents', value: 'a1' },
    ];

    expect(groupFilterOptions(options)).toEqual([
      { kind: 'option', option: { value: 'none' } },
      { kind: 'option', option: { value: 'self' } },
      {
        kind: 'group',
        label: 'Workspace members',
        options: [
          { group: 'Workspace members', value: 'u1' },
          { group: 'Workspace members', value: 'u2' },
        ],
      },
      { kind: 'group', label: 'Agents', options: [{ group: 'Agents', value: 'a1' }] },
    ]);
  });

  it('returns a flat list when no option has a group', () => {
    const options = [{ value: 'a' }, { value: 'b' }];
    expect(groupFilterOptions(options)).toEqual([
      { kind: 'option', option: { value: 'a' } },
      { kind: 'option', option: { value: 'b' } },
    ]);
  });
});
