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

  it('disambiguates a folder and a file that share a name', () => {
    // @pierre/trees keys nodes by bare name within a parent, so `foo/` and
    // `foo` would collide into one ambiguous node without a directory index
    // (the "Unknown directory child index" crash). They must stay distinct.
    const nodes: ExplorerTreeNode[] = [
      { id: 'folder', isFolder: true, name: 'foo', parentId: null },
      { id: 'file', name: 'foo', parentId: null },
    ];

    const tree = normalizeTree(nodes);

    expect(tree.pathById.get('folder')).toBe('foo/');
    expect(tree.pathById.get('file')).toBe('foo (2)');
    // no two nodes share a bare path segment
    expect(new Set(tree.paths.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p))).size).toBe(
      tree.paths.length,
    );
  });

  it('replaces empty names with a fallback instead of emitting a blank segment', () => {
    // A blank segment makes a child path equal to its parent's path, which the
    // path store cannot represent and crashes the panel.
    const nodes: ExplorerTreeNode[] = [
      { id: 'blank-folder', isFolder: true, name: '', parentId: null },
      { id: 'blank-file', name: '   ', parentId: null },
      { id: 'child', name: 'a.md', parentId: 'blank-folder' },
    ];

    const tree = normalizeTree(nodes);

    expect(tree.pathById.get('blank-folder')).toBe('Untitled/');
    expect(tree.pathById.get('blank-file')).toBe('Untitled (2)');
    expect(tree.pathById.get('child')).toBe('Untitled/a.md');
    expect(tree.paths.every((p) => p.replaceAll('/', '') !== '')).toBe(true);
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
