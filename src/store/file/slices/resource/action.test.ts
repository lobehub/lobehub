import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';
import type { CreateDocumentParams, ResourceItem } from '@/types/resource';

const { mockApplyMoveToCaches, mockCreateResource, mockMoveResource, treeState } = vi.hoisted(
  () => ({
    mockApplyMoveToCaches: vi.fn(),
    mockCreateResource: vi.fn(),
    mockMoveResource: vi.fn(),
    treeState: { children: {} as Record<string, any[]> },
  }),
);

vi.mock('@/services/resource', () => ({
  resourceService: {
    createResource: mockCreateResource,
    moveResource: mockMoveResource,
  },
}));

vi.mock('./hooks', () => ({
  applyResourceMoveToListCaches: mockApplyMoveToCaches,
}));

vi.mock('@/store/tree', () => ({
  useTreeStore: { getState: () => treeState },
}));

const createResource = (overrides: Partial<ResourceItem> = {}): ResourceItem => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  fileType: 'text/plain',
  id: 'resource-1',
  name: 'Resource 1',
  parentId: null,
  size: 1,
  sourceType: 'file',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  url: 'files/resource-1.txt',
  ...overrides,
});

describe('resource actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    treeState.children = {};
    useFileStore.setState(initialState);
  });

  it('should keep completed background uploads out of the current resource list when they are off-screen', () => {
    const visibleResource = createResource({
      id: 'visible-1',
      name: 'Visible resource',
      parentId: 'folder-b',
    });
    const optimisticResource = createResource({
      _optimistic: {
        isPending: true,
        retryCount: 0,
      },
      id: 'temp-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });
    const completedResource = createResource({
      id: 'file-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });

    useFileStore.setState({
      queryParams: { parentId: 'folder-b' },
      resourceList: [visibleResource],
      resourceMap: new Map([
        [visibleResource.id, visibleResource],
        [optimisticResource.id, optimisticResource],
      ]),
    });

    useFileStore.getState().replaceLocalResource(optimisticResource.id, completedResource);

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList).toEqual([visibleResource]);
    expect(resourceMap.has(optimisticResource.id)).toBe(false);
    expect(resourceMap.get(completedResource.id)).toEqual(completedResource);
  });

  it('should remove a root item from the visible list when moving it into a folder', async () => {
    const rootResource = createResource({
      id: 'root-1',
      name: 'Root resource',
      parentId: null,
    });
    const movedResource = createResource({
      id: 'root-1',
      name: 'Root resource',
      parentId: 'folder-a',
    });

    mockMoveResource.mockResolvedValue(movedResource);

    useFileStore.setState({
      queryParams: { parentId: null },
      resourceList: [rootResource],
      resourceMap: new Map([[rootResource.id, rootResource]]),
    });

    await useFileStore.getState().moveResource(rootResource.id, 'folder-a');

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList).toEqual([]);
    expect(resourceMap.has(rootResource.id)).toBe(false);
  });

  it('should patch the destination and source folder-list caches once a move lands', async () => {
    // Explorer is inside `2026.09` (URL slug), dragging a row onto the sibling
    // folder row `W37`: the drop target only knows the folder id.
    const targetFolder = createResource({
      fileType: 'custom/folder',
      id: 'folder-w37-id',
      name: '2026.09.W37',
      parentId: 'folder-2026-09-id',
      slug: 'w37-slug',
    });
    const doc = createResource({ id: 'doc-1', name: 'Weekly', parentId: 'folder-2026-09-id' });
    const movedDoc = { ...doc, parentId: targetFolder.id };
    mockMoveResource.mockResolvedValue(movedDoc);
    treeState.children = {
      'folder-2026-09-id': [
        { id: targetFolder.id, isFolder: true, name: targetFolder.name, slug: 'w37-slug' },
      ],
      'root': [{ id: 'folder-2026-09-id', isFolder: true, name: '2026.09', slug: '2026-09-slug' }],
    };

    useFileStore.setState({
      currentFolderId: 'folder-2026-09-id',
      queryParams: { parentId: '2026-09-slug' },
      resourceList: [doc, targetFolder],
      resourceMap: new Map([
        [doc.id, doc],
        [targetFolder.id, targetFolder],
      ]),
    });

    await useFileStore.getState().moveResource(doc.id, targetFolder.id);

    expect(mockApplyMoveToCaches).toHaveBeenCalledTimes(1);
    const [resource, patch] = mockApplyMoveToCaches.mock.calls[0];
    expect(resource).toEqual(movedDoc);
    expect(new Set(patch.fromParentKeys)).toEqual(new Set(['folder-2026-09-id', '2026-09-slug']));
    expect(new Set(patch.toParentKeys)).toEqual(new Set(['folder-w37-id', 'w37-slug']));
  });

  it('should address the root with a null parent key when moving out of a folder', async () => {
    const doc = createResource({ id: 'doc-1', parentId: 'folder-a' });
    mockMoveResource.mockResolvedValue({ ...doc, parentId: null });

    useFileStore.setState({
      queryParams: { parentId: 'folder-a' },
      resourceList: [doc],
      resourceMap: new Map([[doc.id, doc]]),
    });

    await useFileStore.getState().moveResource(doc.id, null);

    const [, patch] = mockApplyMoveToCaches.mock.calls[0];
    expect(patch.toParentKeys).toEqual([null]);
    expect(patch.fromParentKeys).toContain('folder-a');
  });

  it('should treat the current folder as the source when the row omits parentId', async () => {
    // `queryResources` rows carry no `parentId`; the row is in the current list,
    // so the current query's parent (a URL slug) is the folder it leaves.
    const doc = createResource({ id: 'doc-1', parentId: undefined });
    mockMoveResource.mockResolvedValue({ ...doc, parentId: 'folder-w37-id' });

    useFileStore.setState({
      queryParams: { parentId: '2026-09-slug' },
      resourceList: [doc],
      resourceMap: new Map([[doc.id, doc]]),
    });

    await useFileStore.getState().moveResource(doc.id, 'folder-w37-id');

    expect(mockMoveResource).toHaveBeenCalledWith(
      doc.id,
      'folder-w37-id',
      expect.objectContaining({ id: doc.id }),
    );
    const [, patch] = mockApplyMoveToCaches.mock.calls[0];
    expect(patch.fromParentKeys).toContain('2026-09-slug');
    expect(patch.fromParentKeys).not.toContain(null);
    expect(patch.toParentKeys).toEqual(['folder-w37-id']);
  });

  it('should still call the API when the row omits parentId and the target is the root', async () => {
    const doc = createResource({ id: 'doc-1', parentId: undefined });
    mockMoveResource.mockResolvedValue({ ...doc, parentId: null });

    useFileStore.setState({
      queryParams: { parentId: 'folder-a' },
      resourceList: [doc],
      resourceMap: new Map([[doc.id, doc]]),
    });

    await useFileStore.getState().moveResource(doc.id, null);

    expect(mockMoveResource).toHaveBeenCalledWith(
      doc.id,
      null,
      expect.objectContaining({ id: doc.id }),
    );
  });

  it('should not touch the caches when the move is rejected', async () => {
    const doc = createResource({ id: 'doc-1', parentId: null });
    mockMoveResource.mockRejectedValue(new Error('nope'));

    useFileStore.setState({
      queryParams: { parentId: null },
      resourceList: [doc],
      resourceMap: new Map([[doc.id, doc]]),
    });

    await expect(useFileStore.getState().moveResource(doc.id, 'folder-a')).rejects.toThrow();

    expect(mockApplyMoveToCaches).not.toHaveBeenCalled();
  });

  it('should patch a file-backed document resource with statuses returned by file id', () => {
    const resource = createResource({
      chunkCount: null,
      fileId: 'file-1',
      id: 'docs-1',
    });

    useFileStore.setState({
      resourceList: [resource],
      resourceMap: new Map([[resource.id, resource]]),
    });

    useFileStore.getState().patchLocalResourceStatuses([
      {
        chunkCount: 10,
        chunkingError: null,
        chunkingStatus: 'success',
        embeddingError: null,
        embeddingStatus: 'success',
        finishEmbedding: true,
        id: 'file-1',
      },
    ]);

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList[0]).toMatchObject({
      chunkCount: 10,
      chunkingStatus: 'success',
      embeddingStatus: 'success',
      finishEmbedding: true,
      id: 'docs-1',
    });
    expect(resourceMap.get('docs-1')).toMatchObject({
      chunkCount: 10,
      embeddingStatus: 'success',
    });
  });
});

describe('createResourceAndSync list placement', () => {
  const createParams = (parentId: string | null | undefined): CreateDocumentParams => ({
    content: '',
    fileType: 'custom/document',
    knowledgeBaseId: 'kb-1',
    parentId: parentId ?? undefined,
    sourceType: 'document',
    title: 'Untitled',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useFileStore.setState(initialState);
  });

  it('keeps a root-level create out of the list while a folder is open', async () => {
    const folderRow = createResource({ id: 'doc-in-folder', parentId: 'folder-a' });
    useFileStore.setState({
      queryParams: { libraryId: 'kb-1', parentId: 'folder-a-slug' },
      resourceList: [folderRow],
      resourceMap: new Map([[folderRow.id, folderRow]]),
    });
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-root', knowledgeBaseId: 'kb-1', parentId: null }),
    );

    const id = await useFileStore.getState().createResourceAndSync(createParams(null));

    expect(id).toBe('doc-root');
    expect(useFileStore.getState().resourceList.map((item) => item.id)).toEqual(['doc-in-folder']);
    expect(useFileStore.getState().resourceMap.has('doc-root')).toBe(true);
  });

  it('keeps a create inside a folder out of the list while the root is open', async () => {
    const rootRow = createResource({ id: 'doc-root', parentId: null });
    useFileStore.setState({
      queryParams: { libraryId: 'kb-1', parentId: null },
      resourceList: [rootRow],
      resourceMap: new Map([[rootRow.id, rootRow]]),
    });
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-nested', knowledgeBaseId: 'kb-1', parentId: 'folder-a' }),
    );

    await useFileStore.getState().createResourceAndSync(createParams('folder-a'));

    expect(useFileStore.getState().resourceList.map((item) => item.id)).toEqual(['doc-root']);
  });

  it('still lists a create in the open folder when that folder is addressed by slug and not cached', async () => {
    useFileStore.setState({
      queryParams: { libraryId: 'kb-1', parentId: 'folder-a-slug' },
      resourceList: [],
      resourceMap: new Map(),
    });
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-new', knowledgeBaseId: 'kb-1', parentId: 'folder-a' }),
    );

    await useFileStore.getState().createResourceAndSync(createParams('folder-a'));

    expect(useFileStore.getState().resourceList.map((item) => item.id)).toEqual(['doc-new']);
  });
});
