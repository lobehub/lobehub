import { describe, expect, it } from 'vitest';

import type { ExplorerTreeNode } from '../types';
import { isDescendantOf, normalizeTree, remapIdsToPaths, remapPathsToIds } from './normalize';

describe('normalizeTree', () => {
  it('keeps duplicate sibling names addressable by stable ids', () => {
    const nodes: ExplorerTreeNode[] = [
      { id: 'folder-a', isFolder: true, name: 'Docs', parentId: null },
      { id: 'folder-b', isFolder: true, name: 'Docs', parentId: null },
      { id: 'file-a', name: 'README.md', parentId: 'folder-a' },
    ];

    const tree = normalizeTree(nodes);

    expect(tree.pathById.get('folder-a')).toBe('Docs/');
    expect(tree.pathById.get('folder-b')).toBe('Docs (2)/');
    expect(tree.pathById.get('file-a')).toBe('Docs/README.md');
    expect(
      remapPathsToIds(remapIdsToPaths(['folder-b', 'file-a'], tree.pathById), tree.idByPath),
    ).toEqual(['folder-b', 'file-a']);
  });

  it('detects descendants by parent id mapping', () => {
    const tree = normalizeTree([
      {
        children: [
          {
            children: [{ id: 'file-a', name: 'a.md' }],
            id: 'folder-child',
            isFolder: true,
            name: 'Child',
          },
        ],
        id: 'folder-root',
        isFolder: true,
        name: 'Root',
      },
    ]);

    expect(isDescendantOf('folder-child', 'folder-root', tree.parentIdById)).toBe(true);
    expect(isDescendantOf('file-a', 'folder-root', tree.parentIdById)).toBe(true);
    expect(isDescendantOf('folder-root', 'folder-child', tree.parentIdById)).toBe(false);
  });
});
