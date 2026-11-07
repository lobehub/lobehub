import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FileListItem from './index';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Avatar: ({ alt, fallbackVariant }: { alt: string; fallbackVariant?: string }) => (
    <span data-fallback-variant={fallbackVariant} data-testid="avatar">
      {alt}
    </span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: any) => unknown) =>
    selector({
      libraryId: undefined,
      pendingRenameItemId: null,
      selectAllState: 'none',
      selectedFileIds: [],
      setPendingRenameItemId: vi.fn(),
    }),
}));

vi.mock('@/features/ResourceManager/store/selectors', () => ({
  isExplorerItemSelected: () => false,
}));

vi.mock('@/store/file', () => ({
  fileManagerSelectors: {
    isCreatingFileParseTask: () => () => false,
  },
  getChunkTargetId: ({ id }: { id: string }) => id,
  useFileStore: (selector: (state: any) => unknown) =>
    selector({
      parseFilesToChunks: vi.fn(),
      refreshFileList: vi.fn(),
      updateResource: vi.fn(),
    }),
}));

vi.mock('../../hooks/useFileItemClick', () => ({
  useFileItemClick: () => vi.fn(),
  useFileItemDoubleClick: () => vi.fn(),
}));

vi.mock('./FileListItemMenu', () => ({
  default: ({ focusOnMount, openOnMount }: { focusOnMount?: boolean; openOnMount?: boolean }) => (
    <span
      data-focus-on-mount={String(!!focusOnMount)}
      data-open-on-mount={String(!!openOnMount)}
      data-testid="row-menu"
    />
  ),
}));

vi.mock('./FileListItemActions', () => ({
  default: ({ menu }: { menu: React.ReactNode }) => <>{menu}</>,
}));

vi.mock('./FileListItemName', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('./useFileListItemDrag', () => ({
  useFileListItemDrag: () => ({
    handleDragEnd: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragStart: vi.fn(),
    handleDrop: vi.fn(),
    isDragging: false,
    isOver: false,
  }),
}));

vi.mock('./useFileListItemMeta', () => ({
  useFileListItemMeta: () => ({
    displayTime: '2026-07-05',
    emoji: undefined,
    isFolder: false,
    isPage: false,
    isSupportedForChunking: false,
  }),
}));

vi.mock('./useFileListItemRename', () => ({
  useFileListItemRename: () => ({
    handleRenameCancel: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameStart: vi.fn(),
    inputRef: { current: null },
    isRenaming: false,
    renamingValue: '',
    setRenamingValue: vi.fn(),
  }),
}));

const baseProps = {
  chunkCount: null,
  chunkingError: null,
  chunkingStatus: null,
  columnWidths: { date: 160, name: 400, size: 140, uploader: 180 },
  createdAt: new Date('2026-07-05T00:00:00Z'),
  embeddingError: null,
  embeddingStatus: null,
  fileId: 'file-1',
  fileType: 'text/plain',
  finishEmbedding: false,
  id: 'resource-1',
  index: 0,
  name: 'Report.txt',
  onSelectedChange: vi.fn(),
  size: 1024,
  sourceType: 'file',
  updatedAt: new Date('2026-07-05T00:00:00Z'),
  uploader: {
    avatar: null,
    fullName: 'Ada Lovelace',
    id: 'user-1',
    username: 'ada',
  },
  url: '',
};

describe('FileListItem', () => {
  it('hides uploader identity when the private resource library is active', () => {
    render(<FileListItem {...baseProps} showUploader={false} />);

    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
  });

  it('draws the pixel avatar for an uploader without a profile image', () => {
    render(<FileListItem {...baseProps} />);

    expect(screen.getByTestId('avatar')).toHaveAttribute('data-fallback-variant', 'pixel');
  });

  // Regression: every row Virtuoso rendered mounted its own closed Base UI menu
  // (plus the menu hooks), which made scrolling a long drive list stall.
  it('mounts the row menu only once the row is hovered', () => {
    render(<FileListItem {...baseProps} />);

    expect(screen.queryByTestId('row-menu')).not.toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByText('Report.txt').closest('[data-row-index]')!);

    expect(screen.getByTestId('row-menu')).toBeInTheDocument();
  });

  it('mounts the row menu when the row receives keyboard focus', () => {
    render(<FileListItem {...baseProps} />);

    fireEvent.focus(screen.getByRole('checkbox'));

    expect(screen.getByTestId('row-menu')).toBeInTheDocument();
  });

  // Keyboard users must still reach the menu on rows without an enabled
  // checkbox (other members' files, folders, pages).
  it('keeps a focusable menu trigger before the row is activated', () => {
    render(<FileListItem {...baseProps} selectable={false} />);

    const trigger = screen.getByRole('button', { name: 'more' });
    expect(screen.queryByTestId('row-menu')).not.toBeInTheDocument();

    fireEvent.focus(trigger);

    expect(screen.getByTestId('row-menu')).toHaveAttribute('data-focus-on-mount', 'true');
    expect(screen.getByTestId('row-menu')).toHaveAttribute('data-open-on-mount', 'false');
  });

  // Assistive tech and programmatic clicks activate without focus/hover first.
  it('opens the real menu when the placeholder trigger is clicked', () => {
    render(<FileListItem {...baseProps} selectable={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'more' }));

    expect(screen.getByTestId('row-menu')).toHaveAttribute('data-open-on-mount', 'true');
  });

  it('disables selection for rows the workspace member did not upload', () => {
    render(<FileListItem {...baseProps} selectable={false} />);

    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
  });
});
