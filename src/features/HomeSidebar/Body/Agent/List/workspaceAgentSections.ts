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
  /** Public folders the member pinned for themselves. */
  myPinnedFolders: SidebarGroup[];
  /**
   * Rows outside any listed folder that the member created, used recently or
   * added explicitly — public and private together, newest first.
   */
  rest: SidebarAgentItem[];
  /** Rows pinned for everyone by an owner/admin. */
  teamPinned: SidebarAgentItem[];
  /** Public folders pinned for everyone by an owner/admin. */
  teamPinnedFolders: SidebarGroup[];
}

const updatedAtMs = (item: SidebarAgentItem) => new Date(item.updatedAt).getTime() || 0;

/**
 * Whether a row outside the pinned sections belongs in the member's sidebar.
 *
 * Shared workspace rows are a catalogue, not the member's own list, so by
 * default a row is listed only when it is private (only its creator sees it),
 * the member created it, or the member used it within the server's recent
 * window (`lastUsedAt`). An explicit choice from the row menu or the Agents
 * page (`sidebarAgentVisibilityOverrides`) always wins. The legacy hidden-id
 * list is applied separately by the caller.
 */
export const isListedInWorkspaceSidebar = (
  item: Pick<SidebarAgentItem, 'id' | 'lastUsedAt' | 'userId' | 'visibility'>,
  { currentUserId, visibilityOverrides }: WorkspaceSidebarMembership,
): boolean => {
  const override = visibilityOverrides[item.id];
  if (override !== undefined) return override;

  return (
    item.visibility === 'private' ||
    (!!currentUserId && item.userId === currentUserId) ||
    !!item.lastUsedAt
  );
};

/**
 * Lay out the merged workspace "Agents" section from the server's per-bucket
 * sidebar list:
 *
 * 1. Team pins — public rows and public folders with the shared `pinned`
 *    column, set by owners/admins.
 * 2. My pins — ids in the member's `sidebarPinnedItemIds` that are still
 *    listed (dangling ids are skipped): rows first, then public folders. The
 *    member's private rows pinned through their own column by earlier clients
 *    follow. A team pin never repeats here.
 * 3. Folders — only the member's private folders. Public folders are shared
 *    catalogue structure: they live on the Agents page unless pinned.
 * 4. The rest — rows outside any listed folder (including rows inside an
 *    unpinned public folder) that {@link isListedInWorkspaceSidebar} keeps,
 *    newest first.
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

  const teamPinnedFolderIds = new Set(groups.filter((g) => g.pinned).map((g) => g.id));
  const publicGroupById = new Map(groups.map((g) => [g.id, g]));
  const myPinnedFolderIds = myPinnedIds.filter(
    (id) => publicGroupById.has(id) && !teamPinnedFolderIds.has(id),
  );
  const shownPublicFolderIds = new Set([...teamPinnedFolderIds, ...myPinnedFolderIds]);
  const hiddenPublicFolderItems = groups
    .filter((g) => !shownPublicFolderIds.has(g.id))
    .flatMap((g) => g.items);

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
  const withoutPinnedRows = (group: SidebarGroup): SidebarGroup => ({
    ...group,
    items: group.items.filter(notPinned),
  });

  const teamPinnedFolders = groups
    .filter((g) => teamPinnedFolderIds.has(g.id))
    .map(withoutPinnedRows);
  const myPinnedFolders = myPinnedFolderIds.map((id) =>
    withoutPinnedRows(publicGroupById.get(id)!),
  );
  const folders = privateGroups.map(withoutPinnedRows);

  const membership = { currentUserId, visibilityOverrides };
  const rest = [...ungrouped, ...privateUngrouped, ...hiddenPublicFolderItems]
    .filter((item) => notPinned(item) && isListedInWorkspaceSidebar(item, membership))
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a));

  return { folders, myPinned, myPinnedFolders, rest, teamPinned, teamPinnedFolders };
};
