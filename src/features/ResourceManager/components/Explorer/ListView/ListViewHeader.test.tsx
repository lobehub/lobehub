import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ListViewHeader from './ListViewHeader';

const mockUpdateColumnWidth = vi.fn();
const selectionMocks = vi.hoisted(() => ({
  handleSelectAll: vi.fn(),
  handleSelectAllResources: vi.fn(),
}));

vi.mock('@lobehub/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@lobehub/ui');

  return {
    ...actual,
    Checkbox: ({ onChange }: { onChange?: (checked: boolean) => void }) => (
      <button role="checkbox" type="button" onClick={() => onChange?.(true)} />
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (
    selector: (state: {
      updateResourceManagerColumnWidth: typeof mockUpdateColumnWidth;
    }) => unknown,
  ) => selector({ updateResourceManagerColumnWidth: mockUpdateColumnWidth }),
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
    selectAllState: 'loaded',
    selectedCount: 0,
    showSelectAllHint: false,
    total: 0,
  }),
}));

vi.mock('./ColumnResizeHandle', () => ({
  default: ({ column }: { column: string }) => <span data-testid={`resize-${column}`} />,
}));

vi.mock('./ListViewSelectAllHint', () => ({
  default: () => null,
}));

describe('ListViewHeader', () => {
  it('matches row column order for created time and uploader', () => {
    render(
      <ListViewHeader
        columnWidths={{ date: 160, name: 400, size: 140, uploader: 180 }}
        data={[]}
        hasMore={false}
      />,
    );

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
    render(
      <ListViewHeader
        columnWidths={{ date: 160, name: 400, size: 140, uploader: 180 }}
        data={[]}
        hasMore={false}
        showUploader={false}
      />,
    );

    expect(screen.queryByText('FileManager.title.uploader')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-uploader')).not.toBeInTheDocument();
    expect(screen.getByText('FileManager.title.size')).toBeInTheDocument();
  });

  it('promotes a single-page header selection to the full role-scoped result set', () => {
    render(
      <ListViewHeader
        columnWidths={{ date: 160, name: 400, size: 140, uploader: 180 }}
        data={[{ id: 'file-1' } as any]}
        hasMore={false}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(selectionMocks.handleSelectAllResources).toHaveBeenCalledOnce();
    expect(selectionMocks.handleSelectAll).not.toHaveBeenCalled();
  });
});
