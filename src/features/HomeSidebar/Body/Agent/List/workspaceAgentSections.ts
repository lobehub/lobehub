import type { SidebarAgentItem, SidebarGroup } from '@lobechat/types';

export interface WorkspaceSidebarMembership {
  /** Signed-in member. */
  currentUserId?: string | null;
  /** Explicit per-item choice: `true` adds a row, `false` removes it. */
  visibilityOverrides: Readonly<Record<string, boolean>>;
}

export interface WorkspaceAgentSectionsInput extends WorkspaceSidebarMembership {
  /** Public folders. */
  groups: SidebarGroup[];
  /** Ids the member pinned for themselves (agents, chat groups, folders), newest first. */
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
  /** The member's private folders; my-pinned rows taken out. */
  folders: SidebarGroup[];
  /** The member's own pinned rows, in their pin order. */
  myPinned: SidebarAgentItem[];
  /**
   * Rows outside the member's private folders that are their own or that they
   * added explicitly — public and private together, newest first.
   */
  rest: SidebarAgentItem[];
  /** Rows pinned for everyone by an owner/admin. */
  teamPinned: SidebarAgentItem[];
}

const updatedAtMs = (item: SidebarAgentItem) => new Date(item.updatedAt).getTime() || 0;

/**
 * Whether a row outside the pinned sections belongs in the member's sidebar.
 *
 * Shared workspace rows are a catalogue, not the member's own list. By default
 * a row is listed only when it is the member's own — private (only its creator
 * sees it) or created by them — until they hide it. A teammate's shared row is
 * listed only when the member adds it explicitly. An explicit choice from the
 * row menu or the Agents page (`sidebarAgentVisibilityOverrides`) always wins;
 * the release seeded such choices once for the shared rows each member was
 * using. The legacy hidden-id list is applied separately by the caller.
 */
export const isListedInWorkspaceSidebar = (
  item: Pick<SidebarAgentItem, 'id' | 'userId' | 'visibility'>,
  { currentUserId, visibilityOverrides }: WorkspaceSidebarMembership,
): boolean => {
  const override = visibilityOverrides[item.id];
  if (override !== undefined) return override;

  return item.visibility === 'private' || (!!currentUserId && item.userId === currentUserId);
};

/**
 * Lay out the merged workspace "Agents" section from the server's per-bucket
 * sidebar list:
 *
 * 1. Team pins — public rows with the shared `pinned` column, set by
 *    owners/admins.
 * 2. My pins — ids in the member's `sidebarPinnedItemIds` that are still
 *    listed (dangling ids are skipped), then the member's private rows pinned
 *    through their own column by earlier clients. A team pin never repeats.
 * 3. Folders — only the member's private folders. Public folders are shared
 *    catalogue structure browsed on the Agents page.
 * 4. The rest — rows outside the private folders (including rows inside a
 *    public folder) that {@link isListedInWorkspaceSidebar} keeps, newest
 *    first.
 *
 * Every row appears at most once.
 */
export const resolveWorkspaceAgentSections = ({
  currentUserId,
  groups,
  myPinnedIds,
  pinned,
  privateGroups,
  privatePinned,
  privateUngrouped,
  ungrouped,
  visibilityOverrides,
}: WorkspaceAgentSectionsInput): WorkspaceAgentSections => {
  const teamPinned = pinned;
  const teamIds = new Set(teamPinned.map((item) => item.id));

  const publicFolderItems = groups.flatMap((g) => g.items);

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

  const folders = privateGroups.map((group) => ({
    ...group,
    items: group.items.filter(notPinned),
  }));

  const membership = { currentUserId, visibilityOverrides };
  const rest = [...ungrouped, ...privateUngrouped, ...publicFolderItems]
    .filter((item) => notPinned(item) && isListedInWorkspaceSidebar(item, membership))
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a));

  return { folders, myPinned, rest, teamPinned };
};
