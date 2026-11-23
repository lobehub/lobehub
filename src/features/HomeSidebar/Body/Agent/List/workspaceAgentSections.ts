import { INBOX_SESSION_ID } from '@lobechat/const';
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
  /** The member's pinned ids (agents, chat groups) in their own order. */
  myPinnedIds: readonly string[];
  /**
   * Public rows whose shared `pinned` column is set — legacy team pins. The
   * server lists them in their own bucket, so they are only looked up here;
   * the column does not pin them for this member.
   */
  pinned: SidebarAgentItem[];
  /** The member's private folders. */
  privateGroups: SidebarGroup[];
  /** The member's private rows whose own `pinned` column is set. */
  privatePinned: SidebarAgentItem[];
  /** The member's private rows outside any folder. */
  privateUngrouped: SidebarAgentItem[];
  /** The workspace's recommended Agents / chat groups. */
  recommendedIds?: readonly string[];
  /**
   * How the server will set this member's sidebar up, while it has not yet
   * (see `workspaceUserSettingsSelectors.sidebarSetupPreview`). The sidebar
   * already shows the result, so nothing jumps when it lands.
   */
  setupPreview?: 'recommended' | 'teamPins' | null;
  /** Public rows outside any folder. */
  ungrouped: SidebarAgentItem[];
}

export interface WorkspaceAgentSections {
  /** The member's private folders; pinned rows taken out. */
  folders: SidebarGroup[];
  /** The member's pinned rows in their own order. */
  pinned: SidebarAgentItem[];
  /**
   * Rows outside the member's private folders that are their own or that they
   * added explicitly — public and private together, newest first.
   */
  rest: SidebarAgentItem[];
}

const updatedAtMs = (item: SidebarAgentItem) => new Date(item.updatedAt).getTime() || 0;

const isInbox = (item: Pick<SidebarAgentItem, 'slug'>) => item.slug === INBOX_SESSION_ID;

/** Newest first, with Lobe AI (the inbox), the default Agent, leading. */
const byInboxThenRecency = (a: SidebarAgentItem, b: SidebarAgentItem) =>
  Number(isInbox(b)) - Number(isInbox(a)) || updatedAtMs(b) - updatedAtMs(a);

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
 *
 * Lobe AI (the inbox) is the workspace's one shared default Agent, created by
 * whichever member opened it first, so it is listed for everyone by default.
 */
export const isListedInWorkspaceSidebar = (
  item: Pick<SidebarAgentItem, 'id' | 'slug' | 'userId' | 'visibility'>,
  { currentUserId, visibilityOverrides }: WorkspaceSidebarMembership,
): boolean => {
  const override = visibilityOverrides[item.id];
  if (override !== undefined) return override;

  return (
    isInbox(item) ||
    item.visibility === 'private' ||
    (!!currentUserId && item.userId === currentUserId)
  );
};

/**
 * Lay out the merged workspace "Agents" section from the server's per-bucket
 * sidebar list:
 *
 * 1. Pinned — the member's own list: ids in `myPinnedIds` that are still
 *    available, in that order (dangling ids are skipped), then the member's
 *    private rows pinned through their own column by earlier clients. Legacy
 *    team pins only reach it through `myPinnedIds` (copied once, server
 *    side); see `setupPreview` for the moment before.
 * 2. Folders — only the member's private folders. Public folders are shared
 *    catalogue structure browsed on the Agents page.
 * 3. The rest — rows outside the private folders (including rows inside a
 *    public folder or the team-pin bucket) that
 *    {@link isListedInWorkspaceSidebar} keeps, Lobe AI first, then newest
 *    first. A new member's recommended Agents land here (unpinned) once their
 *    sidebar is set up.
 *
 * Every row appears at most once.
 */
export const resolveWorkspaceAgentSections = ({
  currentUserId,
  groups,
  myPinnedIds,
  pinned: teamPinned,
  privateGroups,
  privatePinned,
  privateUngrouped,
  recommendedIds = [],
  setupPreview = null,
  ungrouped,
  visibilityOverrides,
}: WorkspaceAgentSectionsInput): WorkspaceAgentSections => {
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

  const pinned: SidebarAgentItem[] = [];
  const pinnedIds = new Set<string>();
  const addPinned = (item: SidebarAgentItem | undefined) => {
    if (!item || pinnedIds.has(item.id)) return;
    pinnedIds.add(item.id);
    pinned.push(item);
  };
  for (const id of myPinnedIds) addPinned(candidates.get(id));
  if (setupPreview === 'teamPins') for (const item of teamPinned) addPinned(item);
  for (const item of [...privatePinned].sort((a, b) => updatedAtMs(b) - updatedAtMs(a))) {
    addPinned(item);
  }

  const notPinned = (item: SidebarAgentItem) => !pinnedIds.has(item.id);

  const folders = privateGroups.map((group) => ({
    ...group,
    items: group.items.filter(notPinned),
  }));

  const membership = {
    currentUserId,
    visibilityOverrides:
      setupPreview === 'recommended'
        ? { ...Object.fromEntries(recommendedIds.map((id) => [id, true])), ...visibilityOverrides }
        : visibilityOverrides,
  };
  // The server puts each row in exactly one bucket, so no dedupe is needed.
  const rest = [...teamPinned, ...ungrouped, ...privateUngrouped, ...publicFolderItems]
    .filter((item) => notPinned(item) && isListedInWorkspaceSidebar(item, membership))
    .sort(byInboxThenRecency);

  return { folders, pinned, rest };
};
