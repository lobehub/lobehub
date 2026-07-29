import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs, SortType } from '@/types/files';

import ResourceExplorer from './index';

const mocks = vi.hoisted(() => ({
  resourceManagerState: {
    category: 'all' as FilesTabs,
    libraryId: undefined as string | undefined,
    searchQuery: null as string | null,
    sorter: 'createdAt' as const,
    sortType: 'desc' as SortType,
    viewMode: 'list' as const,
  },
  useFetchResources: vi.fn(),
}));

vi.mock('@/routes/(main)/resource/features/hooks/useFolderPath', () => ({
  useFolderPath: () => ({ currentFolderSlug: null }),
}));

vi.mock('@/routes/(main)/resource/features/hooks/useResourceManagerUrlSync', () => ({
  useResourceManagerUrlSync: vi.fn(),
}));

vi.mock('@/routes/(main)/resource/features/store', () => ({
  useResourceManagerStore: (selector: (state: typeof mocks.resourceManagerState) => unknown) =>
    selector(mocks.resourceManagerState),
}));

vi.mock('@/routes/(main)/resource/features/store/selectors', () => ({
  sortFileList: (items: unknown[]) => items,
}));

vi.mock('@/store/file/slices/resource/hooks', () => ({
  useFetchResources: mocks.useFetchResources,
  useResourceStore: () => ({ resourceList: [] }),
}));

vi.mock('../KnowledgeBaseListProvider', () => ({
  KnowledgeBaseListProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./EmptyPlaceholder', () => ({
  default: () => <div data-testid="empty" />,
}));

vi.mock('./Header', () => ({
  default: () => <div data-testid="header" />,
}));

vi.mock('./hooks/useResetSelectionOnQueryChange', () => ({
  useResetSelectionOnQueryChange: vi.fn(),
}));

vi.mock('./ListView', () => ({
  default: () => <div data-testid="list" />,
}));

vi.mock('./MasonryView', () => ({
  default: () => <div data-testid="masonry" />,
}));

vi.mock('./SearchResultsOverlay', () => ({
  default: () => null,
}));

vi.mock('./useCheckTaskStatus', () => ({
  useCheckTaskStatus: vi.fn(),
}));

describe('ResourceExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceManagerState.category = FilesTabs.All;
    mocks.resourceManagerState.libraryId = undefined;
    mocks.resourceManagerState.searchQuery = null;
    mocks.resourceManagerState.sorter = 'createdAt';
    mocks.resourceManagerState.sortType = SortType.Desc;
    mocks.resourceManagerState.viewMode = 'list';
    mocks.useFetchResources.mockReturnValue({ isLoading: false, isValidating: false });
  });

  it('keeps library contents excluded from the All resource query', () => {
    render(<ResourceExplorer />);

    expect(mocks.useFetchResources).toHaveBeenCalledWith(
      expect.objectContaining({
        category: FilesTabs.All,
        libraryId: undefined,
        parentId: null,
        showFilesInKnowledgeBase: false,
      }),
    );
  });
});
