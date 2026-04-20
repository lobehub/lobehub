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
    useResourceManagerStore.setState(initialState);
    useFileStore.setState(fileInitialState);
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

  it('should avoid delete-by-query when all-selected mode has exclusions', async () => {
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
    mockResolveSelectionIds.mockResolvedValue({
      ids: ['file-1', 'file-2', 'file-3'],
    });

    await useResourceManagerStore.getState().onActionClick('delete');

    expect(mockDeleteResourcesByQuery).not.toHaveBeenCalled();
    expect(deleteResources).toHaveBeenCalledWith(['file-1', 'file-3']);
  });
});
