import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResourceTreeMutationDeps } from './mutations';
import { createResourceTreeMutations } from './mutations';
import type { ResourceTreeNode } from './types';

const { mockMoveResource, mockUpdateResource } = vi.hoisted(() => ({
  mockMoveResource: vi.fn(),
  mockUpdateResource: vi.fn(),
}));

vi.mock('@/services/resource', () => ({
  resourceService: {
    moveResource: mockMoveResource,
    updateResource: mockUpdateResource,
  },
}));

const createResourceNode = (
  id: string,
  name: string,
  parentId: string | null,
  isFolder: boolean,
): ResourceTreeNode => ({
  fileType: isFolder ? 'custom/folder' : 'text/markdown',
  id,
  isFolder,
  name,
  parentId,
  url: `/resources/${id}`,
});

const createDeps = (
  childrenByParentId: Map<string | null, ResourceTreeNode[]>,
): ResourceTreeMutationDeps & {
  refreshFileList: ReturnType<typeof vi.fn>;
  revalidateParent: ReturnType<typeof vi.fn>;
  setChildrenByParentId: ReturnType<typeof vi.fn>;
} => {
  const deps = {
    childrenByParentId,
    refreshFileList: vi.fn(),
    revalidateParent: vi.fn(),
    setChildrenByParentId: vi.fn((next: Map<string | null, ResourceTreeNode[]>) => {
      deps.childrenByParentId = next;
    }),
  };

  return deps;
};

describe('createResourceTreeMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('moveTreeItems', () => {
    it('moves loaded items between cached parents, patches cache, and revalidates parents', async () => {
      const sourceFile = createResourceNode('file-a', 'Alpha.md', 'folder-a', false);
      const sourceFolder = createResourceNode('folder-c', 'Charlie', 'folder-a', true);
      const targetFile = createResourceNode('file-b', 'Bravo.md', 'folder-b', false);
      const targetFolder = createResourceNode('folder-d', 'Delta', 'folder-b', true);
      const childrenByParentId = new Map<string | null, ResourceTreeNode[]>([
        ['folder-a', [sourceFile, sourceFolder]],
        ['folder-b', [targetFile, targetFolder]],
      ]);
      const deps = createDeps(childrenByParentId);

      mockMoveResource.mockResolvedValue(undefined);
      deps.revalidateParent.mockResolvedValue(undefined);

      await createResourceTreeMutations(deps).moveTreeItems(
        ['file-a', 'folder-c'],
        'folder-a',
        'folder-b',
      );

      expect(mockMoveResource).toHaveBeenCalledTimes(2);
      expect(mockMoveResource).toHaveBeenCalledWith('file-a', 'folder-b');
      expect(mockMoveResource).toHaveBeenCalledWith('folder-c', 'folder-b');
      expect(deps.setChildrenByParentId).toHaveBeenCalledTimes(1);
      expect(deps.childrenByParentId.get('folder-a')).toEqual([]);
      expect(deps.childrenByParentId.get('folder-b')).toEqual([
        { ...sourceFolder, parentId: 'folder-b' },
        targetFolder,
        { ...sourceFile, parentId: 'folder-b' },
        targetFile,
      ]);
      expect(deps.revalidateParent).toHaveBeenCalledWith('folder-a');
      expect(deps.revalidateParent).toHaveBeenCalledWith('folder-b');
    });

    it('rejects moving a folder into itself or its loaded descendant before calling backend', async () => {
      const folder = createResourceNode('folder-a', 'Folder A', null, true);
      const child = createResourceNode('folder-b', 'Folder B', 'folder-a', true);
      const grandchild = createResourceNode('folder-c', 'Folder C', 'folder-b', true);
      const childrenByParentId = new Map<string | null, ResourceTreeNode[]>([
        [null, [folder]],
        ['folder-a', [child]],
        ['folder-b', [grandchild]],
      ]);
      const deps = createDeps(childrenByParentId);
      const mutations = createResourceTreeMutations(deps);

      await expect(mutations.moveTreeItems(['folder-a'], null, 'folder-a')).rejects.toThrow(
        'Cannot move a resource into itself or its descendant.',
      );
      await expect(mutations.moveTreeItems(['folder-a'], null, 'folder-c')).rejects.toThrow(
        'Cannot move a resource into itself or its descendant.',
      );

      expect(mockMoveResource).not.toHaveBeenCalled();
      expect(deps.setChildrenByParentId).not.toHaveBeenCalled();
      expect(deps.revalidateParent).not.toHaveBeenCalled();
    });

    it('restores cache and revalidates affected parents when backend move rejects', async () => {
      const sourceFile = createResourceNode('file-a', 'Alpha.md', 'folder-a', false);
      const targetFile = createResourceNode('file-b', 'Bravo.md', 'folder-b', false);
      const childrenByParentId = new Map<string | null, ResourceTreeNode[]>([
        ['folder-a', [sourceFile]],
        ['folder-b', [targetFile]],
      ]);
      const deps = createDeps(childrenByParentId);
      const error = new Error('move failed');

      mockMoveResource.mockRejectedValue(error);
      deps.revalidateParent.mockResolvedValue(undefined);

      await expect(
        createResourceTreeMutations(deps).moveTreeItems(['file-a'], 'folder-a', 'folder-b'),
      ).rejects.toThrow(error);

      expect(deps.setChildrenByParentId).toHaveBeenCalledTimes(2);
      expect(deps.childrenByParentId).toBe(childrenByParentId);
      expect(deps.childrenByParentId.get('folder-a')).toEqual([sourceFile]);
      expect(deps.childrenByParentId.get('folder-b')).toEqual([targetFile]);
      expect(deps.revalidateParent).toHaveBeenCalledWith('folder-a');
      expect(deps.revalidateParent).toHaveBeenCalledWith('folder-b');
    });
  });
});
