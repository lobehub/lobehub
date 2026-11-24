import { type SidebarGroup } from '@lobechat/types';

import type { SessionGroupItemBase } from '@/types/session';

export interface ConfigGroupSections {
  /** Visibility of a category added from the dialog; `undefined` keeps the server default. */
  createVisibility?: 'private';
  /** The folders the member's sidebar shows; "Add New Category" appends here. */
  ownGroups: SessionGroupItemBase[];
  /** Folders already published to the workspace, managed in their own list. */
  workspaceGroups: SessionGroupItemBase[];
}

const toSortableItems = (groups: SidebarGroup[]): SessionGroupItemBase[] =>
  groups.map((g) => ({ id: g.id, name: g.name, sort: g.sort }));

/**
 * Split the folders for the category dialog.
 *
 * In a workspace the sidebar is personal and only lists the member's private
 * folders, so those are "own" and new categories are private. Folders already
 * published to the workspace keep a separate list so they stay manageable.
 */
export const resolveConfigGroupSections = ({
  groups,
  isWorkspace,
  privateGroups,
}: {
  groups: SidebarGroup[];
  isWorkspace: boolean;
  privateGroups: SidebarGroup[];
}): ConfigGroupSections =>
  isWorkspace
    ? {
        createVisibility: 'private',
        ownGroups: toSortableItems(privateGroups),
        workspaceGroups: toSortableItems(groups),
      }
    : { ownGroups: toSortableItems(groups), workspaceGroups: [] };
