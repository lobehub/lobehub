import { describe, expect, it } from 'vitest';

import { getDirectoryProjectActionType } from './DirectoryProjectActions';

describe('getDirectoryProjectActionType', () => {
  it('stays loading before the menu opens', () => {
    expect(getDirectoryProjectActionType({ project: undefined, requested: false })).toBe('loading');
  });

  it('stays loading while the lookup is in flight', () => {
    expect(
      getDirectoryProjectActionType({ isLoading: true, project: undefined, requested: true }),
    ).toBe('loading');
  });

  it('offers to view the bound project', () => {
    expect(getDirectoryProjectActionType({ project: { id: 'p1' }, requested: true })).toBe('view');
  });

  it('offers to create a project when the directory is unbound', () => {
    expect(getDirectoryProjectActionType({ project: null, requested: true })).toBe('create');
  });

  it('offers to create a project after a failed lookup instead of hiding the entry', () => {
    expect(getDirectoryProjectActionType({ project: undefined, requested: true })).toBe('create');
  });
});
