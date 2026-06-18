import { render } from '@testing-library/react';
import type { ItemType } from 'antd/es/menu/interface';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import FileListItemActions, { appendTransferMenuItemsBeforeDelete } from './FileListItemActions';

const mocks = vi.hoisted(() => ({
  useFileTransferMenuItem: vi.fn(),
}));

vi.mock('@/business/client/hooks/useFileTransferMenuItem', () => ({
  useFileTransferMenuItem: mocks.useFileTransferMenuItem,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('../../ItemDropdown/DropdownMenu', () => ({
  default: () => null,
}));

describe('appendTransferMenuItemsBeforeDelete', () => {
  it('keeps delete as the final menu action', () => {
    const baseItems = [
      { key: 'copyUrl' },
      { key: 'download' },
      { type: 'divider' },
      { key: 'delete' },
    ] as ItemType[];
    const transferItems = [{ key: 'transfer' }, { key: 'copy' }] as ItemType[];

    const result = appendTransferMenuItemsBeforeDelete(baseItems, transferItems);

    expect(result.map((item) => item && ('key' in item ? item.key : item.type))).toEqual([
      'copyUrl',
      'download',
      'transfer',
      'copy',
      'divider',
      'delete',
    ]);
  });
});

describe('FileListItemActions', () => {
  const baseProps = {
    id: 'resource-1',
    isCreatingFileParseTask: false,
    isFolder: false,
    isPage: false,
    isSupportedForChunking: false,
    menuItems: [],
    parseFiles: vi.fn(),
    t: (key: string) => key,
  };

  it('passes document entity type for page resources', () => {
    mocks.useFileTransferMenuItem.mockReturnValue([]);

    render(React.createElement(FileListItemActions, { ...baseProps, isPage: true }));

    expect(mocks.useFileTransferMenuItem).toHaveBeenCalledWith('resource-1', 'document');
  });
});
