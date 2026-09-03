import { type ResourceManagerMode } from '@/features/ResourceManager';
import { FilesTabs, type ResourceSourceFilter, SortType } from '@/types/files';

export type ViewMode = 'list' | 'masonry';
export type SelectAllState = 'all' | 'loaded' | 'none';

/**
 * Resources Sidebar mode — the "space" the user is currently in inside a
 * team workspace:
 *
 * - `'private'` — my drawer: list only shows the caller's own private rows;
 *   new uploads land as `visibility: 'private'`.
 * - `'workspace'` — team share: list only shows public rows; new uploads
 *   land as `visibility: 'public'`.
 *
 * Personal mode (no workspaceId) ignores this — the toggle isn't rendered
 * and uploads carry no visibility hint (the server treats them as owner-only
 * anyway).
 */
export type ResourceListVisibilityFilter = 'private' | 'workspace';

/**
 * Workspace mode opens on the team share, matching the task list's default:
 * workspace resources are team work by default, and the private drawer stays
 * one click away in the header scope dropdown.
 */
export const DEFAULT_WORKSPACE_LIST_VISIBILITY: ResourceListVisibilityFilter = 'workspace';

export interface State {
  /**
   * Current file category filter
   */
  category: FilesTabs;
  /**
   * Current view item ID (document ID or file ID)
   */
  currentViewItemId?: string;
  /**
   * Current library ID
   */
  libraryId?: string;
  /**
   * Sidebar (library hierarchy) search query. Kept apart from `searchQuery`
   * because the two inputs live on different surfaces: the Explorer overlay
   * is hidden while a page is open, and letting both inputs drive one value
   * makes them fight over it.
   */
  librarySearchQuery: string;
  /**
   * Workspace mode visibility filter for the top-level resource list.
   * Only surfaces the filter chip in Explorer's header when a workspace is
   * active and the user has not drilled into a library or folder.
   */
  listVisibility: ResourceListVisibilityFilter;
  /**
   * View mode for displaying resources
   */
  mode: ResourceManagerMode;
  /**
   * ID of item currently being renamed (for inline editing)
   */
  pendingRenameItemId: string | null;
  /**
   * ID of a tree node that should enter inline rename once it mounts in the
   * sidebar hierarchy. Kept apart from `pendingRenameItemId` (consumed by the
   * Explorer list) so a folder created from the tree's per-folder "+" renames
   * in the tree, not in a list the user may not even be looking at.
   */
  pendingTreeRenameItemId: string | null;
  /**
   * Search query for filtering files
   */
  searchQuery: string | null;
  /**
   * Current select-all mode shared across explorer views
   */
  selectAllState: SelectAllState;
  /**
   * Selected file IDs in the file explorer.
   * When selectAllState === 'all', this stores excluded IDs instead.
   */
  selectedFileIds: string[];
  /**
   * Total rows in the role-scoped select-all query. In a workspace this is
   * caller-owned rows for members and the full visible result set for owners.
   */
  selectionTotal?: number;
  /**
   * Field to sort files by
   */
  sorter: 'name' | 'createdAt' | 'size';
  /**
   * Sort direction (ascending or descending)
   */
  sortType: SortType;
  /**
   * Explicit origin narrowing picked by the user. `undefined` means "not
   * chosen here", which resolves to the category's own default (see
   * `getResourceSourceFilter`) — Images opens on AI-generated, everything else
   * on All. Cleared whenever the category changes so each category comes back
   * to its own default rather than inheriting the previous one's choice.
   */
  sourceFilter?: ResourceSourceFilter;
  /**
   * File explorer view mode (list or masonry)
   */
  viewMode: ViewMode;
}

export const initialState: State = {
  category: FilesTabs.All,
  currentViewItemId: undefined,
  libraryId: undefined,
  librarySearchQuery: '',
  // Personal mode keeps the historical neutral value; workspace mode hydrates
  // to DEFAULT_WORKSPACE_LIST_VISIBILITY when no saved preference exists.
  listVisibility: 'workspace',
  mode: 'explorer',
  pendingRenameItemId: null,
  pendingTreeRenameItemId: null,
  searchQuery: null,
  selectAllState: 'none',
  selectionTotal: undefined,
  selectedFileIds: [],
  sortType: SortType.Desc,
  sorter: 'createdAt',
  sourceFilter: undefined,
  viewMode: 'list',
};
