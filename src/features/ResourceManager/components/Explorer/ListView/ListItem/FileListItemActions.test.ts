import type { ItemType } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileListItemActions, { appendTransferMenuItemsBeforeDelete } from './FileListItemActions';

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    id: 'resource-1',
    isCreatingFileParseTask: false,
    isFolder: false,
    isPage: false,
    isSupportedForChunking: false,
    menu: null,
    parseFiles: vi.fn(),
    t: (key: string) => key,
  };

  it('renders the menu node it is given', () => {
    render(
      React.createElement(FileListItemActions, {
        ...baseProps,
        menu: React.createElement('span', { 'data-testid': 'row-menu' }),
      }),
    );

    expect(screen.getByTestId('row-menu')).toBeInTheDocument();
  });

  it('uses fileId for initial chunk parsing when the resource id is a document id', () => {
    const parseFiles = vi.fn();

    render(
      React.createElement(FileListItemActions, {
        ...baseProps,
        fileId: 'file_1',
        id: 'docs_1',
        isSupportedForChunking: true,
        parseFiles,
      }),
    );

    fireEvent.click(screen.getByText('FileManager.actions.chunking'));

    expect(parseFiles).toHaveBeenCalledWith(['file_1']);
  });
});
