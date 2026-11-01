import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as fileInitialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';
import type { ResourceItem } from '@/types/resource';

import { useResourceManagerStore } from '.';
import { initialState } from './initialState';
import { explorerSearchResource } from './projection';

const {
  mockDeleteResourcesByQuery,
  mockDropNodes,
  mockForgetSnapshot,
  mockResolveSelectionIds,
  mockRevalidateLoaded,
} = vi.hoisted(() => ({
  mockDeleteResourcesByQuery: vi.fn(),
  mockDropNodes: vi.fn(async () => undefined),
  mockForgetSnapshot: vi.fn(),
  mockResolveSelectionIds: vi.fn(),
  mockRevalidateLoaded: vi.fn(async () => undefined),
}));

vi.mock('@/store/tree', () => ({
  useTreeStore: {
    getState: () => ({
      dropNodes: mockDropNodes,
      forgetSnapshot: mockForgetSnapshot,
      revalidateLoaded: mockRevalidateLoaded,
    }),
  },
}));

vi.mock('@/services/resource', () => ({
  resourceService: {
    deleteResourcesByQuery: mockDeleteResourcesByQuery,
    resolveSelectionIds: mockResolveSelectionIds,
  },
}));

describe('resource manager store actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useResourceManagerStore.setState(initialState);
    useFileStore.setState(fileInitialState);
  });

  it('should default workspace resources to workspace mode when no preference is persisted', () => {
    useResourceManagerStore.setState({
      listVisibility: 'private',
      selectAllState: 'loaded',
      selectedFileIds: ['file-1'],
    });

    useResourceManagerStore.getState().hydrateListVisibility('workspace-1');

    expect(useResourceManagerStore.getState()).toMatchObject({
      listVisibility: 'workspace',
      selectAllState: 'none',
      selectedFileIds: [],
    });
  });

  it('should restore the persisted private mode over the workspace default', () => {
    useResourceManagerStore.getState().setListVisibility('private', 'workspace-1');
    useResourceManagerStore.setState({ listVisibility: 'workspace' });

    useResourceManagerStore.getState().hydrateListVisibility('workspace-1');

    expect(useResourceManagerStore.getState().listVisibility).toBe('private');
  });

  it('should drop the previous source rows when the source filter changes', () => {
    // Regression: the pick used to update ResourceManager state only, leaving
    // the previous source's rows on screen and interactive until the fetch
    // landed — and a "select all" fired in that window resolved against the
    // stale queryParams, so the next batch action targeted the wrong source.
    useFileStore.setState({
      queryParams: { category: 'images', sourceFilter: 'generated' } as any,
      resourceList: [{ id: 'file-1' }, { id: 'file-2' }] as any,
      resourceMap: new Map([['file-1', { id: 'file-1' } as any]]),
      selectAllState: 'all',
    } as any);
    useResourceManagerStore.setState({
      selectAllState: 'all',
      selectedFileIds: ['file-9'],
      selectionTotal: 12,
      sourceFilter: 'generated' as any,
    });

    useResourceManagerStore.getState().setSourceFilter('uploaded' as any);

    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'none',
      selectedFileIds: [],
      sourceFilter: 'uploaded',
    });
    expect(useResourceManagerStore.getState().selectionTotal).toBeUndefined();
    expect(useFileStore.getState().resourceList).toEqual([]);
  });

  it('should ignore re-picking the already active source filter', () => {
    useFileStore.setState({ resourceList: [{ id: 'file-1' }] as any } as any);
    useResourceManagerStore.setState({ sourceFilter: 'uploaded' as any });

    useResourceManagerStore.getState().setSourceFilter('uploaded' as any);

    // No clear, so clicking the active chip does not flash the list.
    expect(useFileStore.getState().resourceList).toEqual([{ id: 'file-1' }]);
  });

  it('should exclude deselected ids when resolving all-selected resources', async () => {
    useResourceManagerStore.setState({
      selectAllState: 'all',
      selectedFileIds: ['file-2'],
    });
    useFileStore.setState({
      queryParams: { q: 'report' } as any,
    });
    mockResolveSelectionIds.mockResolvedValue({
      ids: ['file-1', 'file-2', 'file-3'],
    });

    const result = await useResourceManagerStore.getState().resolveSelectedResourceIds();

    expect(mockResolveSelectionIds).toHaveBeenCalledWith({ q: 'report' });
    expect(result).toEqual(['file-1', 'file-3']);
  });

  it('should store the role-scoped total when selecting every query result', async () => {
    useFileStore.setState({ queryParams: { q: 'report' } as any });
    mockResolveSelectionIds.mockResolvedValue({ ids: ['file-1', 'file-2'], total: 2 });

    await useResourceManagerStore.getState().selectAllResources();

    expect(mockResolveSelectionIds).toHaveBeenCalledWith({ q: 'report' });
    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'all',
      selectedFileIds: [],
      selectionTotal: 2,
    });
  });

  it('should keep all-selected deletion caller-scoped when exclusions are present', async () => {
    const deleteResources = vi.fn().mockResolvedValue(undefined);
    const evictResourceLists = vi.fn().mockResolvedValue(undefined);

    useResourceManagerStore.setState({
      selectAllState: 'all',
      selectedFileIds: ['file-2'],
    });
    useFileStore.setState({
      deleteResources,
      evictResourceLists,
      queryParams: { q: 'report' } as any,
    });
    mockDeleteResourcesByQuery.mockResolvedValue({ count: 2 });

    await useResourceManagerStore.getState().onActionClick('delete');

    expect(mockDeleteResourcesByQuery).toHaveBeenCalledWith({ q: 'report' }, ['file-2']);
    expect(mockResolveSelectionIds).not.toHaveBeenCalled();
    expect(deleteResources).not.toHaveBeenCalled();
    expect(evictResourceLists).toHaveBeenCalledTimes(1);
    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: undefined,
    });
  });

  // Regression: the explorer's own list is optimistic, but the sidebar tree
  // keeps a separate per-folder cache that the bulk delete never touched, so
  // deleted rows stayed in the sidebar until a full reload.
  it('should drop the deleted rows from the sidebar tree', async () => {
    const deleteResources = vi.fn().mockResolvedValue(undefined);

    useResourceManagerStore.setState({
      selectAllState: 'loaded',
      selectedFileIds: ['file-1', 'file-2'],
    });
    useFileStore.setState({
      deleteResources,
      queryParams: { parentId: 'folder-a' } as any,
    } as any);

    await useResourceManagerStore.getState().onActionClick('delete');

    expect(deleteResources).toHaveBeenCalledWith(['file-1', 'file-2']);
    expect(mockDropNodes).toHaveBeenCalledWith(['file-1', 'file-2'], 'folder-a');
  });

  // Regression: the explorer's search overlay mirrors cached replica pages, so
  // a deleted hit kept showing there (and came back after a reload) until the
  // row was dropped from the cache as part of the delete.
  it('should drop the deleted rows from the cached explorer searches', async () => {
    const params = { pageSize: 50, q: 'report' } as any;
    const key = explorerSearchResource.key(params);
    const row = (id: string): ResourceItem => ({ fileType: 'custom/document', id, name: id });

    useResourceManagerStore.setState({
      explorerSearchEntries: {
        [key]: {
          currentPage: 0,
          hasMore: false,
          items: [row('file-1'), row('file-2')],
          pageSize: 50,
          searchParams: params,
          total: 2,
        },
      },
      selectAllState: 'loaded',
      selectedFileIds: ['file-1'],
    });
    useFileStore.setState({
      deleteResources: vi.fn().mockResolvedValue(undefined),
      queryParams: { parentId: 'folder-a' } as any,
    } as any);

    await useResourceManagerStore.getState().onActionClick('delete');

    const entry = useResourceManagerStore.getState().explorerSearchEntries[key];
    expect(entry?.items.map((item) => item.id)).toEqual(['file-2']);
    expect(entry?.total).toBe(1);
  });

  it('should drop the cached explorer searches when the deleted set is server-only', async () => {
    const params = { pageSize: 50, q: 'report' } as any;
    const key = explorerSearchResource.key(params);

    useResourceManagerStore.setState({
      explorerSearchEntries: {
        [key]: {
          currentPage: 0,
          hasMore: false,
          items: [{ fileType: 'custom/document', id: 'file-1', name: 'file-1' }],
          pageSize: 50,
          searchParams: params,
          total: 1,
        },
      },
      selectAllState: 'all',
      selectedFileIds: [],
    });
    useFileStore.setState({
      deleteResources: vi.fn(),
      evictResourceLists: vi.fn().mockResolvedValue(undefined),
      queryParams: { parentId: 'folder-a' } as any,
    } as any);
    mockDeleteResourcesByQuery.mockResolvedValue({ count: 1 });

    await useResourceManagerStore.getState().onActionClick('delete');

    // No id is known client-side, so the cached searches are dropped whole and
    // the refetch paints whatever survived.
    expect(useResourceManagerStore.getState().explorerSearchEntries[key]).toBeUndefined();
  });

  it('should refresh every loaded folder when the deleted set is only known to the server', async () => {
    useResourceManagerStore.setState({ selectAllState: 'all', selectedFileIds: [] });
    useFileStore.setState({
      deleteResources: vi.fn(),
      evictResourceLists: vi.fn().mockResolvedValue(undefined),
      queryParams: { parentId: 'folder-a' } as any,
    } as any);
    mockDeleteResourcesByQuery.mockResolvedValue({ count: 3 });

    await useResourceManagerStore.getState().onActionClick('delete');

    // Individual ids never reach the client here. A library-wide search also
    // matched rows in other expanded folders, so every loaded folder is refetched
    // — not only the one behind the explorer.
    expect(mockRevalidateLoaded).toHaveBeenCalledWith('folder-a');
    expect(mockDropNodes).not.toHaveBeenCalled();
    // A refetch that never lands must not leave the deleted rows in the persisted tree.
    expect(mockForgetSnapshot).toHaveBeenCalledTimes(1);
  });

  // Regression: removing search hits from the library only refreshed the
  // folder list, so the removed rows and the old count stayed in the library's
  // search results.
  it('should refresh the cached library searches after removing hits from the library', async () => {
    const { useKnowledgeBaseStore } = await import('@/store/library');
    const removeFilesFromKnowledgeBase = vi.fn().mockResolvedValue(undefined);
    useKnowledgeBaseStore.setState({ removeFilesFromKnowledgeBase } as any);

    const params = { libraryId: 'lib-1', pageSize: 50, q: 'report' } as any;
    const key = explorerSearchResource.key(params);
    useResourceManagerStore.setState({
      explorerSearchEntries: {
        [key]: {
          currentPage: 0,
          hasMore: false,
          items: [{ fileType: 'application/pdf', id: 'hit-1', name: 'hit-1' }],
          pageSize: 50,
          searchParams: params,
          total: 1,
        },
      },
      libraryId: 'lib-1',
      selectAllState: 'loaded',
      selectedFileIds: ['hit-1'],
    });

    await useResourceManagerStore.getState().onActionClick('removeFromKnowledgeBase');

    expect(removeFilesFromKnowledgeBase).toHaveBeenCalledWith('lib-1', ['hit-1']);
    await vi.waitFor(() =>
      expect(useResourceManagerStore.getState().explorerSearchEntries[key]).toBeUndefined(),
    );
  });

  // Regression: while the search overlay was up, "select all" and the batch
  // delete resolved against the folder list behind it, so they acted on rows
  // the user had never seen instead of the search hits.
  describe('while the search overlay is up', () => {
    beforeEach(() => {
      useResourceManagerStore.setState({ searchQuery: 'report' });
      useFileStore.setState({ queryParams: { parentId: 'folder-a' } as any });
    });

    it('should select every search hit, not the folder list', async () => {
      mockResolveSelectionIds.mockResolvedValue({ ids: ['hit-1', 'hit-2'], total: 2 });

      await useResourceManagerStore.getState().selectAllResources();

      const query = mockResolveSelectionIds.mock.calls[0][0];
      expect(query).toMatchObject({ filesOnly: true, q: 'report' });
      expect(query).not.toHaveProperty('parentId');
      expect(useResourceManagerStore.getState().selectionTotal).toBe(2);
    });

    it('should delete the whole search query instead of a lookup per hit', async () => {
      const deleteResources = vi.fn().mockResolvedValue(undefined);
      useResourceManagerStore.setState({ selectAllState: 'all', selectedFileIds: ['hit-2'] });
      useFileStore.setState({ deleteResources } as any);
      mockDeleteResourcesByQuery.mockResolvedValue({ count: 2 });

      await useResourceManagerStore.getState().onActionClick('delete');

      // The exclusions ride along with the query: no id resolution, and no
      // per-hit detail lookup inside `deleteResources` for every hit.
      expect(mockDeleteResourcesByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ filesOnly: true, q: 'report' }),
        ['hit-2'],
      );
      expect(mockDeleteResourcesByQuery.mock.calls[0][0]).not.toHaveProperty('parentId');
      expect(mockResolveSelectionIds).not.toHaveBeenCalled();
      expect(deleteResources).not.toHaveBeenCalled();
      // The deleted ids are only known to the server now, so the tree is
      // dropped and refetched instead of patched row by row.
      expect(mockDropNodes).not.toHaveBeenCalled();
      expect(mockForgetSnapshot).toHaveBeenCalledTimes(1);
    });

    it('should chunk search hits that live outside the listed folder', async () => {
      const parseFilesToChunks = vi.fn().mockResolvedValue(undefined);
      const params = { pageSize: 50, q: 'report' } as any;
      useResourceManagerStore.setState({
        explorerSearchEntries: {
          [explorerSearchResource.key(params)]: {
            currentPage: 0,
            hasMore: false,
            items: [{ fileType: 'application/pdf', id: 'hit-1', name: 'report.pdf' }],
            pageSize: 50,
            searchParams: params,
            total: 1,
          },
        },
        selectAllState: 'loaded',
        selectedFileIds: ['hit-1'],
      });
      useFileStore.setState({ parseFilesToChunks } as any);

      await useResourceManagerStore.getState().onActionClick('batchChunking');

      expect(parseFilesToChunks).toHaveBeenCalledWith(['hit-1'], { skipExist: true });
    });
  });
});

describe('library sidebar search', () => {
  beforeEach(() => {
    useResourceManagerStore.setState(initialState);
  });

  it('should store the sidebar search query', () => {
    useResourceManagerStore.getState().setLibrarySearchQuery('weekly');

    expect(useResourceManagerStore.getState().librarySearchQuery).toBe('weekly');
  });

  it('should reset the sidebar search query when switching library', () => {
    useResourceManagerStore.setState({ libraryId: 'kb-1', librarySearchQuery: 'weekly' });

    useResourceManagerStore.getState().setLibraryId('kb-2');

    expect(useResourceManagerStore.getState()).toMatchObject({
      libraryId: 'kb-2',
      librarySearchQuery: '',
    });
  });

  it('should keep the sidebar search query when the same library is re-synced from the URL', () => {
    useResourceManagerStore.setState({ libraryId: 'kb-1', librarySearchQuery: 'weekly' });

    useResourceManagerStore.getState().setLibraryId('kb-1');

    expect(useResourceManagerStore.getState().librarySearchQuery).toBe('weekly');
  });
});

describe('pending tree rename', () => {
  beforeEach(() => {
    useResourceManagerStore.setState(initialState);
  });

  it('should set and clear the pending tree rename item id', () => {
    useResourceManagerStore.getState().setPendingTreeRenameItemId('folder-1');
    expect(useResourceManagerStore.getState().pendingTreeRenameItemId).toBe('folder-1');

    useResourceManagerStore.getState().setPendingTreeRenameItemId(null);
    expect(useResourceManagerStore.getState().pendingTreeRenameItemId).toBeNull();
  });
});
