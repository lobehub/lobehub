import { render, screen } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import FileListItem from './index';

vi.mock('@lobehub/ui', () => {
  const Box = ({ children, className, style, ...props }: any) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => key.startsWith('data-') || key.startsWith('aria-')),
    );

    return (
      <div className={className} style={style as CSSProperties} {...domProps}>
        {children}
      </div>
    );
  };

  return {
    Avatar: ({ alt }: { alt: string }) => <span data-testid="avatar">{alt}</span>,
    Center: Box,
    Checkbox: ({ checked }: { checked?: boolean }) => (
      <input readOnly checked={checked} type="checkbox" />
    ),
    ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Flexbox: Box,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock('@/routes/(main)/resource/features/store', () => ({
  useResourceManagerStore: (selector: (state: any) => unknown) =>
    selector({
      libraryId: undefined,
      pendingRenameItemId: null,
      selectAllState: 'none',
      selectedFileIds: [],
      setPendingRenameItemId: vi.fn(),
    }),
}));

vi.mock('@/routes/(main)/resource/features/store/selectors', () => ({
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
}));

vi.mock('../../ItemDropdown/useFileItemDropdown', () => ({
  useFileItemDropdown: () => ({ menuItems: [] }),
}));

vi.mock('./FileListItemActions', () => ({
  default: () => null,
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
});
