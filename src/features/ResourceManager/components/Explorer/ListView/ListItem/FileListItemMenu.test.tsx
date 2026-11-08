import type { ItemType } from '@lobehub/ui';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileListItemMenuGetter } from './FileListItemMenu';
import FileListItemMenu from './FileListItemMenu';

const mocks = vi.hoisted(() => ({
  dropdownItems: vi.fn(),
  menuItems: vi.fn(),
  useFileTransferMenuItem: vi.fn(),
}));

vi.mock('@/business/client/hooks/useFileTransferMenuItem', () => ({
  useFileTransferMenuItem: mocks.useFileTransferMenuItem,
}));

vi.mock('../../ItemDropdown/useFileItemDropdown', () => ({
  useFileItemDropdown: () => ({ menuItems: mocks.menuItems }),
}));

vi.mock('../../ItemDropdown/DropdownMenu', () => ({
  default: ({ items }: { items: unknown }) => {
    mocks.dropdownItems(items);
    return <button type="button">menu-trigger</button>;
  },
}));

const baseProps = {
  fileType: 'text/plain',
  filename: 'Report.txt',
  id: 'resource-1',
  isFolder: false,
  isPage: false,
  size: 1024,
  url: '',
};

describe('FileListItemMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.menuItems.mockReturnValue([{ key: 'download' }, { key: 'delete' }] as ItemType[]);
    mocks.useFileTransferMenuItem.mockReturnValue([{ key: 'transfer' }] as ItemType[]);
  });

  it('passes document entity type for page resources', () => {
    const menuItemsRef = createRef<FileListItemMenuGetter | null>();

    render(<FileListItemMenu {...baseProps} isPage menuItemsRef={menuItemsRef} />);

    expect(mocks.useFileTransferMenuItem).toHaveBeenCalledWith('resource-1', 'document');
  });

  it('builds the dropdown items lazily, with transfer actions before delete', () => {
    const menuItemsRef = createRef<FileListItemMenuGetter | null>();

    render(<FileListItemMenu {...baseProps} menuItemsRef={menuItemsRef} />);

    // Nothing is resolved until a menu actually opens.
    expect(mocks.menuItems).not.toHaveBeenCalled();
    const dropdownItems = mocks.dropdownItems.mock.lastCall?.[0] as () => ItemType[];
    expect(dropdownItems).toBeTypeOf('function');

    const keys = dropdownItems().map((item) => item && 'key' in item && item.key);
    expect(keys).toEqual(['download', 'transfer', 'delete']);
  });

  it('gives the row context menu the base actions, as before', () => {
    const menuItemsRef = createRef<FileListItemMenuGetter | null>();

    render(<FileListItemMenu {...baseProps} menuItemsRef={menuItemsRef} />);

    const keys = menuItemsRef.current!().map((item) => item && 'key' in item && item.key);
    expect(keys).toEqual(['download', 'delete']);
  });

  it('moves focus to the real trigger when activated from the keyboard', () => {
    const menuItemsRef = createRef<FileListItemMenuGetter | null>();

    render(<FileListItemMenu {...baseProps} focusOnMount menuItemsRef={menuItemsRef} />);

    expect(screen.getByRole('button', { name: 'menu-trigger' })).toHaveFocus();
  });
});
