import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';

export interface FolderSection {
  /** The folder itself; absent for the trailing "No folder" bucket. */
  folder?: SidebarGroup;
  items: SidebarAgentItem[];
  key: string;
  label: string;
}

/**
 * Bucket the (already filtered and sorted) page items by their sidebar folder.
 * Folders keep their shared order and stay listed even when empty, so the
 * shared catalogue reads the same for everyone; rows outside any folder
 * collect in a trailing bucket.
 */
export const groupItemsByFolder = (
  items: SidebarAgentItem[],
  folders: SidebarGroup[],
  noFolderLabel: string,
): FolderSection[] => {
  const known = new Set(folders.map((folder) => folder.id));
  const byFolder = new Map<string, SidebarAgentItem[]>();
  const loose: SidebarAgentItem[] = [];

  for (const item of items) {
    if (item.groupId && known.has(item.groupId)) {
      const bucket = byFolder.get(item.groupId);
      if (bucket) bucket.push(item);
      else byFolder.set(item.groupId, [item]);
    } else {
      loose.push(item);
    }
  }

  const sections: FolderSection[] = folders.map((folder) => ({
    folder,
    items: byFolder.get(folder.id) ?? [],
    key: `folder:${folder.id}`,
    label: folder.name,
  }));
  if (loose.length > 0) sections.push({ items: loose, key: 'folder:none', label: noFolderLabel });

  return sections;
};
