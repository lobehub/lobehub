import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as fileInitialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';

import { useResourceManagerStore } from '.';
import { initialState } from './initialState';

const { mockDeleteResourcesByQuery, mockResolveSelectionIds } = vi.hoisted(() => ({
  mockDeleteResourcesByQuery: vi.fn(),
  mockResolveSelectionIds: vi.fn(),
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

  it('should default workspace resources to private mode when no preference is persisted', () => {
    useResourceManagerStore.setState({
      listVisibility: 'workspace',
      selectAllState: 'loaded',
      selectedFileIds: ['file-1'],
    });

    useResourceManagerStore.getState().hydrateListVisibility('workspace-1');

    expect(useResourceManagerStore.getState()).toMatchObject({
      listVisibility: 'private',
      selectAllState: 'none',
      selectedFileIds: [],
    });
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

    useResourceManagerStore.setState({
      selectAllState: 'all',
      selectedFileIds: ['file-2'],
    });
    useFileStore.setState({
      clearCurrentQueryResources: vi.fn(),
      deleteResources,
      queryParams: { q: 'report' } as any,
    });
    mockDeleteResourcesByQuery.mockResolvedValue({ count: 2 });

    await useResourceManagerStore.getState().onActionClick('delete');

    expect(mockDeleteResourcesByQuery).toHaveBeenCalledWith({ q: 'report' }, ['file-2']);
    expect(mockResolveSelectionIds).not.toHaveBeenCalled();
    expect(deleteResources).not.toHaveBeenCalled();
    expect(useResourceManagerStore.getState()).toMatchObject({
      selectAllState: 'none',
      selectedFileIds: [],
      selectionTotal: undefined,
    });
  });
});
