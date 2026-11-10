import { describe, expect, it } from 'vitest';

import { resolveToolLabelIds } from './labels';

const registry = [
  { id: 'g', isGroup: true, name: 'Type', parentId: null },
  { id: 'bug', isGroup: false, name: 'Bug', parentId: 'g' },
  { id: 'fe', isGroup: false, name: 'Frontend', parentId: null },
];

describe('resolveToolLabelIds', () => {
  it('resolves names and ignores blanks', () => {
    expect(resolveToolLabelIds(registry, ['bug', ' ', 'Frontend'])).toEqual({ ids: ['bug', 'fe'] });
    expect(resolveToolLabelIds(registry, undefined)).toEqual({ ids: [] });
  });

  it('accepts group names only for filters', () => {
    expect(resolveToolLabelIds(registry, ['Type'], { allowGroups: true })).toEqual({ ids: ['g'] });
    expect(resolveToolLabelIds(registry, ['Type']).error).toContain('is a label group');
  });

  it('explains unknown names without creating anything', () => {
    expect(resolveToolLabelIds(registry, ['Frontnd']).error).toContain('did you mean: Frontend');
    expect(resolveToolLabelIds([], ['x']).error).toContain('no task labels yet');
  });
});
