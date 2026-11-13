import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';

export interface WorkspaceAgentSectionsInput {
  /** Public folders. */
  groups: SidebarGroup[];
  /** Ids the member pinned for themselves, newest first. */
  myPinnedIds: readonly string[];
  /** Public rows whose shared `pinned` column is set — the team pins. */
  pinned: SidebarAgentItem[];
  /** The member's private folders. */
  privateGroups: SidebarGroup[];
  /** The member's private rows whose own `pinned` column is set. */
  privatePinned: SidebarAgentItem[];
  /** The member's private rows outside any folder. */
  privateUngrouped: SidebarAgentItem[];
  /** Public rows outside any folder. */
  ungrouped: SidebarAgentItem[];
}

export interface WorkspaceAgentSections {
  /** Public folders first, then private ones; my-pinned rows taken out. */
  folders: SidebarGroup[];
  /** The member's own pins, in their pin order. */
  myPinned: SidebarAgentItem[];
  /** Everything else outside a folder, public and private, newest first. */
  rest: SidebarAgentItem[];
  /** Pinned for everyone by an owner/admin. */
  teamPinned: SidebarAgentItem[];
}

const updatedAtMs = (item: SidebarAgentItem) => new Date(item.updatedAt).getTime() || 0;

/**
 * Lay out the merged workspace "Agents" section from the server's per-bucket
 * sidebar list:
 *
 * 1. Team pins — public rows with the shared `pinned` column.
 * 2. My pins — ids in the member's `sidebarPinnedItemIds` that are still
 *    listed (dangling ids from deleted rows are skipped), then the member's
 *    private rows pinned through their own column by earlier clients. A team
 *    pin never repeats here.
 * 3. Folders — public then private, minus rows already under "My pins".
 * 4. The rest — public and private ungrouped rows together, newest first.
 *
 * Every row appears at most once. Only reorganizes what the server returned;
 * nothing is dropped except duplicates.
 */
export const resolveWorkspaceAgentSections = ({
  groups,
  myPinnedIds,
  pinned,
  privateGroups,
  privatePinned,
  privateUngrouped,
  ungrouped,
}: WorkspaceAgentSectionsInput): WorkspaceAgentSections => {
  const teamPinned = pinned;
  const teamIds = new Set(teamPinned.map((item) => item.id));

  const candidates = new Map<string, SidebarAgentItem>();
  for (const item of [
    ...privatePinned,
    ...groups.flatMap((group) => group.items),
    ...privateGroups.flatMap((group) => group.items),
    ...ungrouped,
    ...privateUngrouped,
  ]) {
    if (!teamIds.has(item.id) && !candidates.has(item.id)) candidates.set(item.id, item);
  }

  const myPinned: SidebarAgentItem[] = [];
  const myIds = new Set<string>();
  const addMine = (item: SidebarAgentItem | undefined) => {
    if (!item || myIds.has(item.id) || teamIds.has(item.id)) return;
    myIds.add(item.id);
    myPinned.push(item);
  };
  for (const id of myPinnedIds) addMine(candidates.get(id));
  for (const item of [...privatePinned].sort((a, b) => updatedAtMs(b) - updatedAtMs(a))) {
    addMine(item);
  }

  const notPinned = (item: SidebarAgentItem) => !myIds.has(item.id) && !teamIds.has(item.id);

  const folders = [...groups, ...privateGroups].map((group) => ({
    ...group,
    items: group.items.filter(notPinned),
  }));

  const rest = [...ungrouped, ...privateUngrouped]
    .filter(notPinned)
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a));

  return { folders, myPinned, rest, teamPinned };
};
