import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs } from '@/types/files';

import { useExplorerListData } from './useExplorerListData';

const mocks = vi.hoisted(() => ({
  fileState: {
    hasMore: false,
    queryParams: { category: 'all', parentId: null },
    resourceList: [{ id: 'resource-1', name: 'Report' }],
  },
  globalState: {
    status: {},
  },
  resourceManagerState: {
    sorter: 'createdAt' as const,
    sortType: 'desc' as const,
  },
}));

vi.mock('@/routes/(main)/resource/features/hooks/useCurrentFolderId', () => ({
  useCurrentFolderId: () => null,
}));

vi.mock('@/routes/(main)/resource/features/store', () => ({
  useResourceManagerStore: (selector: (state: typeof mocks.resourceManagerState) => unknown) =>
    selector(mocks.resourceManagerState),
}));

vi.mock('@/routes/(main)/resource/features/store/selectors', () => ({
  sortFileList: (items: unknown[]) => items,
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: typeof mocks.fileState) => unknown) => selector(mocks.fileState),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof mocks.globalState) => unknown) =>
    selector(mocks.globalState),
}));

describe('useExplorerListData', () => {
  beforeEach(() => {
    mocks.fileState = {
      hasMore: false,
      queryParams: { category: 'all', parentId: null },
      resourceList: [{ id: 'resource-1', name: 'Report' }],
    };
  });

  it('shows skeleton while navigating even before SWR starts validating', () => {
    const { result } = renderHook(() =>
      useExplorerListData({
        isLoading: false,
        isValidating: false,
        queryParams: { category: FilesTabs.Documents, parentId: null },
      }),
    );

    expect(result.current.showSkeleton).toBe(true);
  });
});
