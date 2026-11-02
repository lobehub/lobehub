import type { ItemType } from '@lobehub/ui';
import type { RefObject } from 'react';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';

import { useFileTransferMenuItem } from '@/business/client/hooks/useFileTransferMenuItem';

import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import { useFileItemDropdown } from '../../ItemDropdown/useFileItemDropdown';
import { appendTransferMenuItemsBeforeDelete } from './FileListItemActions';

export type FileListItemMenuGetter = () => ItemType[];

type FileItemDropdownParams = Parameters<typeof useFileItemDropdown>[0];

interface FileListItemMenuProps extends Pick<
  FileItemDropdownParams,
  | 'fileId'
  | 'fileType'
  | 'filename'
  | 'id'
  | 'libraryId'
  | 'onRenameStart'
  | 'size'
  | 'sourceType'
  | 'url'
  | 'userId'
  | 'visibility'
> {
  className?: string;
  /** Move focus to the menu trigger once mounted (activated from the keyboard). */
  focusOnMount?: boolean;
  isFolder: boolean;
  isPage: boolean;
  /** Receives the base item getter for the row's right-click menu. */
  menuItemsRef: RefObject<FileListItemMenuGetter | null>;
  /** Open the menu on mount (the placeholder trigger was clicked or activated). */
  openOnMount?: boolean;
}

/**
 * The row's "…" dropdown and the source of its context menu items.
 *
 * Mounted only once a row is hovered or focused: every hook here (store
 * selectors, the messenger SWR queries, the transfer targets) and the Base UI
 * menu tree behind `DropdownMenu` used to run for each of the ~60 rows Virtuoso
 * keeps mounted, so scrolling paid for dozens of closed menus per frame.
 */
const FileListItemMenu = memo<FileListItemMenuProps>(
  ({
    className,
    fileId,
    focusOnMount,
    openOnMount,
    fileType,
    filename,
    id,
    isFolder,
    isPage,
    libraryId,
    menuItemsRef,
    onRenameStart,
    size,
    sourceType,
    url,
    userId,
    visibility,
  }) => {
    const { menuItems } = useFileItemDropdown({
      fileId,
      fileType,
      filename,
      id,
      libraryId,
      onRenameStart,
      size,
      sourceType,
      url,
      userId,
      visibility,
    });
    const transferMenuItems = useFileTransferMenuItem(
      id,
      isPage ? 'document' : isFolder ? 'folder' : 'file',
    );

    // Resolved only when a menu actually opens.
    const getMenuItems = useCallback(
      () => appendTransferMenuItemsBeforeDelete(menuItems(), transferMenuItems),
      [menuItems, transferMenuItems],
    );

    // The right-click menu keeps its previous contents: the base actions only.
    useLayoutEffect(() => {
      menuItemsRef.current = menuItems;
    }, [menuItems, menuItemsRef]);

    const wrapperRef = useRef<HTMLSpanElement>(null);
    // Read once: only the mount that replaces a focused placeholder moves focus.
    const focusOnMountRef = useRef(focusOnMount);

    useLayoutEffect(() => {
      if (!focusOnMountRef.current) return;
      wrapperRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
    }, []);

    return (
      <span ref={wrapperRef} style={{ display: 'contents' }}>
        <DropdownMenu className={className} defaultOpen={openOnMount} items={getMenuItems} />
      </span>
    );
  },
);

FileListItemMenu.displayName = 'FileListItemMenu';

export default FileListItemMenu;
