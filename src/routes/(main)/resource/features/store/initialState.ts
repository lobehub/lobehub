import { type ResourceManagerMode } from '@/features/ResourceManager';
import { FilesTabs, SortType } from '@/types/files';

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

export const DEFAULT_WORKSPACE_LIST_VISIBILITY: ResourceListVisibilityFilter = 'private';

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
   * Field to sort files by
   */
  sorter: 'name' | 'createdAt' | 'size';
  /**
   * Sort direction (ascending or descending)
   */
  sortType: SortType;
  /**
   * File explorer view mode (list or masonry)
   */
  viewMode: ViewMode;
}

export const initialState: State = {
  category: FilesTabs.All,
  currentViewItemId: undefined,
  libraryId: undefined,
  // Personal mode keeps the historical neutral value; workspace mode hydrates
  // to DEFAULT_WORKSPACE_LIST_VISIBILITY when no saved preference exists.
  listVisibility: 'workspace',
  mode: 'explorer',
  pendingRenameItemId: null,
  searchQuery: null,
  selectAllState: 'none',
  selectedFileIds: [],
  sortType: SortType.Desc,
  sorter: 'createdAt',
  viewMode: 'list',
};
