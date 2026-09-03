import { describe, expect, it } from 'vitest';

import { isHierarchyNodeActive, resolveHierarchySelectedKey } from './selection';

describe('resolveHierarchySelectedKey', () => {
  it('prefers the opened file over the current folder', () => {
    expect(
      resolveHierarchySelectedKey({ currentFolderSlug: 'folder-a', currentViewItemId: 'file_1' }),
    ).toBe('file_1');
  });

  it('falls back to the current folder', () => {
    expect(resolveHierarchySelectedKey({ currentFolderSlug: 'folder-a' })).toBe('folder-a');
    expect(resolveHierarchySelectedKey({})).toBeNull();
  });
});

describe('isHierarchyNodeActive', () => {
  const file = { id: 'file_1', isFolder: false, slug: 'my-page' };
  const folder = { id: 'folder_1', isFolder: true, slug: 'folder-a' };

  it('marks the opened file active by id, not slug', () => {
    expect(isHierarchyNodeActive(file, 'file_1')).toBe(true);
    expect(isHierarchyNodeActive(file, 'my-page')).toBe(false);
  });

  it('marks the current folder active by slug with id fallback', () => {
    expect(isHierarchyNodeActive(folder, 'folder-a')).toBe(true);
    expect(isHierarchyNodeActive({ ...folder, slug: null }, 'folder_1')).toBe(true);
  });

  it('drops folder highlight once a file is opened', () => {
    expect(isHierarchyNodeActive(folder, 'file_1')).toBe(false);
    expect(isHierarchyNodeActive(file, null)).toBe(false);
  });
});
