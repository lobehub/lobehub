import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ListViewHeader from './ListViewHeader';

const mockUpdateColumnWidth = vi.fn();
const selectionMocks = vi.hoisted(() => ({
  handleSelectAll: vi.fn(),
  handleSelectAllResources: vi.fn(),
}));
const selectionSummary = vi.hoisted(() => ({
  selectAllState: 'loaded' as 'all' | 'loaded' | 'none',
  selectedCount: 0,
  total: 0,
}));
const store = vi.hoisted(() => ({
  sorter: 'createdAt' as 'custom' | 'name' | 'createdAt' | 'size',
  sortType: 'desc' as 'asc' | 'desc',
  setSorter: vi.fn(),
  setSortType: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: {
      updateResourceManagerColumnWidth: typeof mockUpdateColumnWidth;
    }) => unknown,
  ) => selector({ updateResourceManagerColumnWidth: mockUpdateColumnWidth }),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock('../hooks/useExplorerSelection', () => ({
  useExplorerSelectionActions: () => ({
    handleSelectAll: selectionMocks.handleSelectAll,
    handleSelectAllResources: selectionMocks.handleSelectAllResources,
  }),
  useExplorerSelectionSummary: () => ({
    allSelected: false,
    hasSelectableItems: true,
    indeterminate: false,
    selectableCount: 1,
    selectAllState: selectionSummary.selectAllState,
    selectedCount: selectionSummary.selectedCount,
    showSelectAllHint: false,
    total: selectionSummary.total,
  }),
}));

vi.mock('./ListViewSelectAllHint', () => ({
  default: () => null,
}));

const columnWidths = { date: 160, name: 400, size: 140, uploader: 180 };

const renderHeader = (props: Partial<React.ComponentProps<typeof ListViewHeader>> = {}) =>
  render(<ListViewHeader columnWidths={columnWidths} data={[]} hasMore={false} {...props} />);

const getHeader = (name: string) => screen.getByRole('button', { name });

describe('ListViewHeader', () => {
  beforeEach(() => {
    store.sorter = 'createdAt';
    store.sortType = 'desc';
    store.setSorter.mockReset();
    store.setSortType.mockReset();
    selectionSummary.selectAllState = 'loaded';
    selectionSummary.selectedCount = 0;
    selectionSummary.total = 0;
  });

  it('matches row column order for created time and uploader', () => {
    renderHeader();

    const title = screen.getByText('FileManager.title.title');
    const createdAt = screen.getByText('FileManager.title.createdAt');
    const uploader = screen.getByText('FileManager.title.uploader');
    const size = screen.getByText('FileManager.title.size');

    expect(
      title.compareDocumentPosition(createdAt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      createdAt.compareDocumentPosition(uploader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(uploader.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides uploader column when the private resource library is active', () => {
    renderHeader({ showUploader: false });

    expect(screen.queryByText('FileManager.title.uploader')).not.toBeInTheDocument();
    expect(document.querySelector('[data-column-resize-handle="uploader"]')).toBeNull();
    expect(screen.getByText('FileManager.title.size')).toBeInTheDocument();
  });

  it('promotes a single-page header selection to the full role-scoped result set', () => {
    renderHeader({ data: [{ id: 'file-1' } as any] });

    fireEvent.click(screen.getByRole('checkbox'));

    expect(selectionMocks.handleSelectAllResources).toHaveBeenCalledOnce();
    expect(selectionMocks.handleSelectAll).not.toHaveBeenCalled();
  });

  it('sorts by Name ascending when the column is inactive', () => {
    renderHeader();

    fireEvent.click(getHeader('FileManager.title.title'));

    expect(store.setSorter).toHaveBeenCalledWith('name');
    expect(store.setSortType).toHaveBeenCalledWith('asc');
  });

  it('toggles the direction when clicking the active column', () => {
    renderHeader();

    fireEvent.click(getHeader('FileManager.title.createdAt'));

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).toHaveBeenCalledWith('asc');
  });

  it('defaults Created At and Size to descending when they are inactive', () => {
    store.sorter = 'name';
    store.sortType = 'asc';
    renderHeader();

    fireEvent.click(getHeader('FileManager.title.createdAt'));
    expect(store.setSorter).toHaveBeenCalledWith('createdAt');
    expect(store.setSortType).toHaveBeenCalledWith('desc');

    store.setSorter.mockReset();
    store.setSortType.mockReset();
    fireEvent.click(getHeader('FileManager.title.size'));
    expect(store.setSorter).toHaveBeenCalledWith('size');
    expect(store.setSortType).toHaveBeenCalledWith('desc');
  });

  it('supports Enter and Space on sortable headers', () => {
    renderHeader();

    fireEvent.keyDown(getHeader('FileManager.title.title'), { key: 'Enter' });
    expect(store.setSorter).toHaveBeenCalledWith('name');

    store.setSorter.mockReset();
    store.setSortType.mockReset();
    fireEvent.keyDown(getHeader('FileManager.title.size'), { key: ' ' });

    expect(store.setSorter).toHaveBeenCalledWith('size');
    expect(store.setSortType).toHaveBeenCalledWith('desc');
  });

  it('renders a direction arrow only next to the active column', () => {
    store.sorter = 'createdAt';
    store.sortType = 'desc';
    const { unmount } = renderHeader();

    expect(
      getHeader('FileManager.title.createdAt').querySelector('.lucide-arrow-down'),
    ).not.toBeNull();
    expect(getHeader('FileManager.title.title').querySelector('svg')).toBeNull();

    unmount();
    store.sorter = 'name';
    store.sortType = 'asc';
    renderHeader();

    expect(getHeader('FileManager.title.title').querySelector('.lucide-arrow-up')).not.toBeNull();
    expect(getHeader('FileManager.title.createdAt').querySelector('svg')).toBeNull();
  });

  it('never sorts when the column resize handle is clicked', () => {
    renderHeader();

    fireEvent.click(document.querySelector('[data-column-resize-handle="name"]')!);

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).not.toHaveBeenCalled();
  });

  it('suppresses the click after a resize drag releases outside the handle', () => {
    renderHeader();

    const handle = document.querySelector('[data-column-resize-handle="name"]')!;
    fireEvent.mouseDown(handle, { clientX: 400 });
    fireEvent.mouseUp(document);

    // The browser dispatches the post-resize click on the common ancestor.
    fireEvent.click(getHeader('FileManager.title.title'));

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).not.toHaveBeenCalled();
  });

  it('does not turn the multi-select summary into a sort control', () => {
    selectionSummary.selectedCount = 2;
    renderHeader();

    expect(
      screen.queryByRole('button', { name: 'FileManager.title.title' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('FileManager.total.selectedCount'));

    expect(store.setSorter).not.toHaveBeenCalled();
    expect(store.setSortType).not.toHaveBeenCalled();
  });
});
