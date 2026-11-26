import { type SidebarGroup } from '@lobechat/types';

import type { SessionGroupItemBase } from '@/types/session';

export interface ConfigGroupList {
  /** Visibility of a category added from the dialog; `undefined` keeps the server default. */
  createVisibility?: 'private';
  /** The folders the member's sidebar shows. */
  items: SessionGroupItemBase[];
}

/**
 * The folders the category dialog manages: the ones the sidebar shows.
 *
 * The workspace sidebar is personal and only lists the member's private
 * folders, so the dialog manages those and new categories are private.
 * Folders published to the workspace are browsed on the Agents page.
 */
export const resolveConfigGroupList = ({
  groups,
  isWorkspace,
  privateGroups,
}: {
  groups: SidebarGroup[];
  isWorkspace: boolean;
  privateGroups: SidebarGroup[];
}): ConfigGroupList => {
  const source = isWorkspace ? privateGroups : groups;
  const items = source.map((g) => ({ id: g.id, name: g.name, sort: g.sort }));

  return isWorkspace ? { createVisibility: 'private', items } : { items };
};
