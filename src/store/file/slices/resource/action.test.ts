import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';
import type { CreateDocumentParams, ResourceItem } from '@/types/resource';

import type { ResourceListParams, ResourceListValue } from './projection';

const {
  mockAddFilesToKnowledgeBase,
  mockCreateResource,
  mockDeleteResource,
  mockDeleteResources,
  mockMoveResource,
  mockRemoveFilesFromKnowledgeBase,
  mockUpdateResource,
} = vi.hoisted(() => ({
  mockAddFilesToKnowledgeBase: vi.fn(),
  mockCreateResource: vi.fn(),
  mockDeleteResource: vi.fn(),
  mockDeleteResources: vi.fn(),
  mockMoveResource: vi.fn(),
  mockRemoveFilesFromKnowledgeBase: vi.fn(),
  mockUpdateResource: vi.fn(),
}));

vi.mock('@/services/resource', () => ({
  resourceService: {
    createResource: mockCreateResource,
    deleteResource: mockDeleteResource,
    deleteResources: mockDeleteResources,
    moveResource: mockMoveResource,
    updateResource: mockUpdateResource,
  },
}));

vi.mock('@/services/knowledgeBase', () => ({
  knowledgeBaseService: {
    addFilesToKnowledgeBase: mockAddFilesToKnowledgeBase,
    removeFilesFromKnowledgeBase: mockRemoveFilesFromKnowledgeBase,
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
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

/**
 * Seed the replica view exactly as the lens would after a head page landed:
 * the flat fields and the entry stay in step, so the slice's engine reads the
 * same rows the selectors do.
 */
const seedList = (
  params: Partial<ResourceListParams>,
  items: ResourceItem[],
  meta: Partial<ResourceListValue> = {},
) => {
  const queryParams: ResourceListParams = {
    pageSize: 50,
    parentId: null,
    showFilesInKnowledgeBase: false,
    ...params,
  };
  const entry: ResourceListValue = {
    currentPage: 0,
    hasMore: false,
    items,
    nextCursor: null,
    pageSize: queryParams.pageSize,
    queryParams,
    total: items.length,
    ...meta,
  };

  useFileStore.setState({
    hasMore: entry.hasMore,
    isLoadingMore: false,
    offset: items.length,
    queryParams: entry.queryParams,
    resourceList: items,
    resourceListEntry: entry,
    resourceMap: new Map(items.map((item) => [item.id, item])),
    total: entry.total ?? items.length,
  });
};

const listIds = () => useFileStore.getState().resourceList.map((item) => item.id);

describe('resource actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileStore.setState(initialState);
  });

  it('keeps a completed background upload out of the visible list when it is off-screen', () => {
    const visibleResource = createResource({
      id: 'visible-1',
      name: 'Visible resource',
      parentId: 'folder-b',
    });
    const optimisticResource = createResource({
      _optimistic: { isPending: true, retryCount: 0 },
      id: 'temp-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });
    const completedResource = createResource({
      id: 'file-a',
      name: 'Background upload',
      parentId: 'folder-a',
    });

    seedList({ parentId: 'folder-b' }, [visibleResource]);

    useFileStore.getState().replaceLocalResource(optimisticResource.id, completedResource);

    const { resourceList, resourceMap } = useFileStore.getState();

    expect(resourceList).toEqual([visibleResource]);
    // The replica view is per query: a row for another folder never enters the
    // open folder's list, so it is not in the derived map either.
    expect(resourceMap.has(optimisticResource.id)).toBe(false);
    expect(resourceMap.has(completedResource.id)).toBe(false);
  });

  it('replaces the temp row in place when the upload belongs to the open folder', () => {
    const temp = createResource({ _optimistic: { isPending: true, retryCount: 0 }, id: 'temp-a' });
    seedList({}, [temp]);

    useFileStore.getState().replaceLocalResource('temp-a', createResource({ id: 'file-a' }));

    expect(listIds()).toEqual(['file-a']);
    expect(useFileStore.getState().resourceMap.has('temp-a')).toBe(false);
  });

  it('inserts a local upload row at the head of the list', () => {
    seedList({}, [createResource({ id: 'existing' })]);

    const id = useFileStore.getState().insertLocalResource(
      {
        fileType: 'text/plain',
        name: 'Upload',
        size: 3,
        sourceType: 'file',
        url: '',
      },
      'temp-upload',
    );

    expect(id).toBe('temp-upload');
    expect(listIds()).toEqual(['temp-upload', 'existing']);
  });

  it('removes a root item from the visible list when moving it into a folder', async () => {
    const rootResource = createResource({ id: 'root-1', parentId: null });
    mockMoveResource.mockResolvedValue(createResource({ id: 'root-1', parentId: 'folder-a' }));

    seedList({ parentId: null }, [rootResource]);

    await useFileStore.getState().moveResource(rootResource.id, 'folder-a');

    expect(listIds()).toEqual([]);
    expect(useFileStore.getState().resourceMap.has(rootResource.id)).toBe(false);
    // The row's own copy rides along, so the move stays one request.
    expect(mockMoveResource).toHaveBeenCalledWith(
      'root-1',
      'folder-a',
      expect.objectContaining({ id: 'root-1' }),
    );
  });

  it('keeps a row visible when it moves within the open folder', async () => {
    const folderChild = createResource({ id: 'child-1', parentId: 'folder-a' });
    mockMoveResource.mockResolvedValue(createResource({ id: 'child-1', parentId: 'folder-a' }));

    seedList({ parentId: 'folder-a' }, [folderChild]);

    await useFileStore.getState().moveResource('child-1', 'folder-a');

    expect(listIds()).toEqual(['child-1']);
  });

  it('rolls the moved row back when the server rejects the move', async () => {
    const rootResource = createResource({ id: 'root-1', parentId: null });
    mockMoveResource.mockRejectedValue(new Error('nope'));

    seedList({ parentId: null }, [rootResource]);

    await expect(useFileStore.getState().moveResource('root-1', 'folder-a')).rejects.toThrow();

    // Rollback restores the row and its original parent.
    expect(listIds()).toEqual(['root-1']);
    expect(useFileStore.getState().resourceMap.get('root-1')?.parentId).toBeNull();
  });

  it('should not call the API when the row is already in the target folder', async () => {
    const folderChild = createResource({ id: 'child-1', parentId: 'folder-a' });
    seedList({ parentId: 'folder-a' }, [folderChild]);

    await useFileStore.getState().moveResource('child-1', 'folder-a');

    expect(mockMoveResource).not.toHaveBeenCalled();
  });

  it('optimistically drops deleted rows and restores them on failure', async () => {
    const rows = [createResource({ id: 'r1' }), createResource({ id: 'r2' })];
    mockDeleteResources.mockRejectedValue(new Error('nope'));

    seedList({}, rows);

    await expect(useFileStore.getState().deleteResources(['r1'])).rejects.toThrow();

    expect(listIds()).toEqual(['r1', 'r2']);

    mockDeleteResources.mockResolvedValue(undefined);
    await useFileStore.getState().deleteResources(['r1']);

    expect(listIds()).toEqual(['r2']);
  });

  it('optimistically renames a row and confirms it with the server response', async () => {
    const resource = createResource({ id: 'r1', name: 'Before' });
    const renamed = createResource({ id: 'r1', name: 'After' });
    mockUpdateResource.mockResolvedValue(renamed);

    seedList({}, [resource]);

    const promise = useFileStore.getState().updateResource('r1', { name: 'After' });

    expect(useFileStore.getState().resourceMap.get('r1')?.name).toBe('After');

    await promise;

    expect(useFileStore.getState().resourceMap.get('r1')?.name).toBe('After');
    expect(useFileStore.getState().resourceList[0]._optimistic).toBeUndefined();
  });

  it('patches a file-backed document resource with statuses returned by file id', () => {
    const resource = createResource({ chunkCount: null, fileId: 'file-1', id: 'docs-1' });

    seedList({}, [resource]);

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

    expect(useFileStore.getState().resourceMap.get('docs-1')).toMatchObject({
      chunkCount: 10,
      chunkingStatus: 'success',
      embeddingStatus: 'success',
      finishEmbedding: true,
      id: 'docs-1',
    });
  });

  it('removes rows from the list when the open view is that knowledge base', async () => {
    const rows = [createResource({ id: 'r1', knowledgeBaseId: 'kb-1' })];
    mockRemoveFilesFromKnowledgeBase.mockResolvedValue(undefined);

    seedList({ libraryId: 'kb-1' }, rows);

    await useFileStore.getState().removeResourcesFromKnowledgeBase('kb-1', ['r1']);

    expect(listIds()).toEqual([]);
    expect(mockRemoveFilesFromKnowledgeBase).toHaveBeenCalledWith('kb-1', ['r1']);
  });

  it('clears the painted rows but keeps the queried params', () => {
    seedList({ parentId: 'folder-a' }, [createResource({ id: 'r1', parentId: 'folder-a' })]);

    useFileStore.getState().clearCurrentQueryResources();

    expect(listIds()).toEqual([]);
    expect(useFileStore.getState().queryParams?.parentId).toBe('folder-a');
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
    seedList({ libraryId: 'kb-1', parentId: 'folder-a-slug' }, [folderRow]);
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-root', knowledgeBaseId: 'kb-1', parentId: null }),
    );

    const id = await useFileStore.getState().createResourceAndSync(createParams(null));

    expect(id).toBe('doc-root');
    expect(listIds()).toEqual(['doc-in-folder']);
    expect(useFileStore.getState().resourceMap.has('doc-root')).toBe(false);
  });

  it('keeps a create inside a folder out of the list while the root is open', async () => {
    const rootRow = createResource({ id: 'doc-root', parentId: null });
    seedList({ libraryId: 'kb-1', parentId: null }, [rootRow]);
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-nested', knowledgeBaseId: 'kb-1', parentId: 'folder-a' }),
    );

    await useFileStore.getState().createResourceAndSync(createParams('folder-a'));

    expect(listIds()).toEqual(['doc-root']);
  });

  it('still lists a create in the open folder when that folder is addressed by slug and not cached', async () => {
    seedList({ libraryId: 'kb-1', parentId: 'folder-a-slug' }, []);
    mockCreateResource.mockResolvedValue(
      createResource({ id: 'doc-new', knowledgeBaseId: 'kb-1', parentId: 'folder-a' }),
    );

    await useFileStore.getState().createResourceAndSync(createParams('folder-a'));

    expect(listIds()).toEqual(['doc-new']);
  });
});
