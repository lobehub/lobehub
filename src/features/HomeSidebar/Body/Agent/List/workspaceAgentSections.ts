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
  /**
   * The member's pinned ids (agents, chat groups) in their own order. Holds
   * team pins too once the member rearranged the list.
   */
  myPinnedIds: readonly string[];
  /** Public rows whose shared `pinned` column is set — the team pins, in team order. */
  pinned: SidebarAgentItem[];
  /** Whether the member rearranged their pinned list. */
  pinnedOrderCustomized?: boolean;
  /** The member's private folders. */
  privateGroups: SidebarGroup[];
  /** The member's private rows whose own `pinned` column is set. */
  privatePinned: SidebarAgentItem[];
  /** The member's private rows outside any folder. */
  privateUngrouped: SidebarAgentItem[];
  /** Public rows outside any folder. */
  ungrouped: SidebarAgentItem[];
  /** Team pins the member unpinned for themselves. */
  unpinnedTeamIds?: readonly string[];
}

export interface WorkspaceAgentSections {
  /** The member's private folders; pinned rows taken out. */
  folders: SidebarGroup[];
  /**
   * The member's pinned rows in display order: their own pins and the team
   * pins they did not unpin, in one list the member can rearrange.
   */
  pinned: SidebarAgentItem[];
  /**
   * Rows outside the member's private folders that are their own, that they
   * added explicitly or whose team pin they removed — public and private
   * together, newest first.
   */
  rest: SidebarAgentItem[];
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
 * 1. Pinned — one list. Team pins (public rows with the shared `pinned`
 *    column, set by owners/admins) are only a recommendation: the member can
 *    unpin them or move them among their own pins.
 *    - Ids in `myPinnedIds` that are still available, in that order (dangling
 *      ids are skipped), then the member's private rows pinned through their
 *      own column by earlier clients.
 *    - Team pins not placed there and not unpinned by the member go after
 *      them in team order while the member never rearranged the list, and
 *      first once they did — a pin added for the team later is a new
 *      recommendation.
 * 2. Folders — only the member's private folders. Public folders are shared
 *    catalogue structure browsed on the Agents page.
 * 3. The rest — rows outside the private folders (including rows inside a
 *    public folder) that {@link isListedInWorkspaceSidebar} keeps, plus team
 *    pins the member unpinned unless they also removed them, newest first.
 *
 * Every row appears at most once.
 */
export const resolveWorkspaceAgentSections = ({
  currentUserId,
  groups,
  myPinnedIds,
  pinned: teamPinned,
  pinnedOrderCustomized = false,
  privateGroups,
  privatePinned,
  privateUngrouped,
  unpinnedTeamIds = [],
  ungrouped,
  visibilityOverrides,
}: WorkspaceAgentSectionsInput): WorkspaceAgentSections => {
  const unpinnedTeam = new Set(unpinnedTeamIds);
  const teamIds = new Set(teamPinned.map((item) => item.id));
  const publicFolderItems = groups.flatMap((g) => g.items);

  const candidates = new Map<string, SidebarAgentItem>();
  for (const item of [
    ...teamPinned,
    ...privatePinned,
    ...publicFolderItems,
    ...privateGroups.flatMap((group) => group.items),
    ...ungrouped,
    ...privateUngrouped,
  ]) {
    if (!candidates.has(item.id)) candidates.set(item.id, item);
  }

  const mine: SidebarAgentItem[] = [];
  const pinnedIds = new Set<string>();
  const addPinned = (list: SidebarAgentItem[], item: SidebarAgentItem | undefined) => {
    if (!item || pinnedIds.has(item.id)) return;
    pinnedIds.add(item.id);
    list.push(item);
  };
  for (const id of myPinnedIds) addPinned(mine, candidates.get(id));
  for (const item of [...privatePinned].sort((a, b) => updatedAtMs(b) - updatedAtMs(a))) {
    addPinned(mine, item);
  }

  const unplacedTeam: SidebarAgentItem[] = [];
  for (const item of teamPinned) {
    if (!unpinnedTeam.has(item.id)) addPinned(unplacedTeam, item);
  }

  const pinned = pinnedOrderCustomized ? [...unplacedTeam, ...mine] : [...mine, ...unplacedTeam];

  const notPinned = (item: SidebarAgentItem) => !pinnedIds.has(item.id);

  const folders = privateGroups.map((group) => ({
    ...group,
    items: group.items.filter(notPinned),
  }));

  // An unpinned team pin stays in the sidebar until the member removes it.
  const membership = { currentUserId, visibilityOverrides };
  const isListed = (item: SidebarAgentItem) =>
    isListedInWorkspaceSidebar(item, membership) ||
    (teamIds.has(item.id) && visibilityOverrides[item.id] !== false);

  const seen = new Set<string>();
  const rest = [...teamPinned, ...ungrouped, ...privateUngrouped, ...publicFolderItems]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return notPinned(item) && isListed(item);
    })
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a));

  return { folders, pinned, rest };
};
