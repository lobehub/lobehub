import { describe, expect, it } from 'vitest';

import {
  hierarchySubtreeHoldsSelection,
  isHierarchyNodeActive,
  resolveDeletedFolderRedirect,
  resolveHierarchySelectedKey,
} from './selection';

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

describe('hierarchySubtreeHoldsSelection', () => {
  const folderA = { id: 'folder_a', isFolder: true, slug: 'folder-a' };
  const folderB = { id: 'folder_b', isFolder: true, slug: 'folder-b' };
  const page = { id: 'file_1', isFolder: false, slug: 'my-page' };

  // Regression: the guard used to compare the row against the selection
  // directly, so deleting an ANCESTOR of the folder the explorer was listing
  // left it on a route naming a folder that no longer existed.
  const children = {
    '': [folderA],
    'folder_a': [folderB],
    'folder_b': [page],
  } as any;

  it('matches the folder the explorer is parked in', () => {
    expect(hierarchySubtreeHoldsSelection(folderA, children, 'folder-a')).toBe(true);
  });

  it('matches an ancestor of the current folder', () => {
    expect(hierarchySubtreeHoldsSelection(folderA, children, 'folder-b')).toBe(true);
  });

  it('matches an ancestor of the opened file', () => {
    expect(hierarchySubtreeHoldsSelection(folderA, children, 'file_1')).toBe(true);
  });

  it('ignores a sibling subtree', () => {
    expect(hierarchySubtreeHoldsSelection(folderB, children, 'folder-a')).toBe(false);
  });

  it('ignores an empty selection', () => {
    expect(hierarchySubtreeHoldsSelection(folderA, children, null)).toBe(false);
  });

  it('stays put for a subtree the sidebar never loaded', () => {
    expect(hierarchySubtreeHoldsSelection(folderA, { '': [folderA] } as any, 'folder-b')).toBe(
      false,
    );
  });

  it('terminates on a cyclic children map', () => {
    const cyclic = { folder_a: [folderB], folder_b: [folderA] } as any;

    expect(hierarchySubtreeHoldsSelection(folderA, cyclic, 'nothing-here')).toBe(false);
  });
});

describe('resolveDeletedFolderRedirect', () => {
  const folderA = { id: 'folder_a', isFolder: true, slug: 'folder-a' };
  const folderB = { id: 'folder_b', isFolder: true, slug: 'folder-b' };
  const page = { id: 'file_1', isFolder: false, slug: 'my-page' };
  const children = { '': [folderA], 'folder_a': [folderB], 'folder_b': [page] } as any;

  const base = { children, item: folderB, libraryId: 'kb_1', parentKey: 'folder_a' };

  it("steps out to the deleted folder's parent", () => {
    expect(resolveDeletedFolderRedirect({ ...base, selectedKey: 'folder-b' })).toBe(
      '/resource/library/kb_1/folder-a',
    );
  });

  it('steps out to the library root for a top-level folder', () => {
    expect(
      resolveDeletedFolderRedirect({
        ...base,
        item: folderA,
        parentKey: '',
        selectedKey: 'folder-a',
      }),
    ).toBe('/resource/library/kb_1');
  });

  it('steps out when the selection is below the deleted folder', () => {
    expect(
      resolveDeletedFolderRedirect({
        ...base,
        item: folderA,
        parentKey: '',
        selectedKey: 'file_1',
      }),
    ).toBe('/resource/library/kb_1');
  });

  // Regression: the delete is async. If the user opens another folder while it
  // is still in flight, the callback captured when the context menu was
  // rendered used to fire with the stale selection and pull them back to the
  // deleted folder's parent — after they had already navigated away.
  it('stays put when the selection moved out of the subtree mid-delete', () => {
    expect(resolveDeletedFolderRedirect({ ...base, selectedKey: 'somewhere-else' })).toBeNull();
  });

  it('stays put with no selection at all', () => {
    expect(resolveDeletedFolderRedirect({ ...base, selectedKey: null })).toBeNull();
  });

  it('stays put for a file row', () => {
    expect(resolveDeletedFolderRedirect({ ...base, item: page, selectedKey: 'file_1' })).toBeNull();
  });

  // The user switched library while the delete was in flight.
  it('stays put without a live library', () => {
    expect(
      resolveDeletedFolderRedirect({ ...base, libraryId: undefined, selectedKey: 'folder-b' }),
    ).toBeNull();
  });
});
