import { describe, expect, it } from 'vitest';

import { deriveLoadedTree } from './deriveLoadedTree';
import type { ResourceTreeNode } from './types';

const createResourceNode = (
  id: string,
  name: string,
  parentId: string | null,
  isFolder: boolean,
): ResourceTreeNode => ({
  fileType: isFolder ? 'folder' : 'markdown',
  id,
  isFolder,
  name,
  parentId,
  url: `/resources/${id}`,
});

describe('deriveLoadedTree', () => {
  it('includes loaded children only for expanded folders', () => {
    const folderA = createResourceNode('folder-a', 'Folder A', null, true);
    const folderB = createResourceNode('folder-b', 'Folder B', null, true);
    const fileA = createResourceNode('file-a', 'File A.md', 'folder-a', false);
    const fileB = createResourceNode('file-b', 'File B.md', 'folder-b', false);
    const childrenByParentId = new Map<string | null, ResourceTreeNode[]>([
      [null, [folderA, folderB]],
      ['folder-a', [fileA]],
      ['folder-b', [fileB]],
    ]);

    const tree = deriveLoadedTree({
      childrenByParentId,
      expandedIds: new Set(['folder-a']),
    });

    expect(tree).toEqual([
      {
        children: [
          {
            data: fileA,
            id: 'file-a',
            isFolder: false,
            name: 'File A.md',
            parentId: 'folder-a',
          },
        ],
        data: folderA,
        id: 'folder-a',
        isFolder: true,
        name: 'Folder A',
        parentId: null,
      },
      {
        data: folderB,
        id: 'folder-b',
        isFolder: true,
        name: 'Folder B',
        parentId: null,
      },
    ]);
    expect(tree[1]).not.toHaveProperty('children');
  });
});
