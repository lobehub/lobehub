import { fileManagerSelectors, useFileStore } from '@/store/file';
import { compareResourceItems } from '@/store/file/slices/resource/utils';
import { type FileListItem, FilesTabs, ResourceSourceFilter, SortType } from '@/types/files';
import type { ResourceSorter } from '@/types/resource';

import type { ResourceListVisibilityFilter, SelectAllState, State } from './initialState';
import { DEFAULT_SEARCH_PAGE_SIZE, type ExplorerSearchParams } from './projection';

export { compareResourceItems } from '@/store/file/slices/resource/utils';

/**
 * The Private / Workspace switch scopes the resource home only. Once the user
 * enters a concrete library, the library and server ownership rules define the
 * visible pool; reusing the home filter there can hide the entire library.
 */
export const getResourceQueryVisibility = (
  libraryId: string | undefined,
  listVisibility: ResourceListVisibilityFilter,
): 'private' | 'public' | undefined => {
  if (libraryId) return undefined;

  return listVisibility === 'private' ? 'private' : 'public';
};

/**
 * Categories where "where did this come from" is a question worth asking: the
 * media categories, and only those. Generation produces images, video and
 * audio — so those are the lists where uploads and model output actually mix
 * and need separating.
 *
 * Documents and raw files have no generated counterpart, and the All view is a
 * cross-category overview rather than a place to narrow by origin; offering the
 * filter there would be four controls that can only ever partition the list one
 * way. Pages hold no files and Home is a dashboard.
 */
export const SOURCE_FILTER_CATEGORIES: FilesTabs[] = [
  FilesTabs.Audios,
  FilesTabs.Images,
  FilesTabs.Videos,
];

/**
 * The images category is dominated by generation output — a few uploaded
 * screenshots against hundreds of generated images — so it opens on the
 * generated set. Every other category opens on everything.
 */
const DEFAULT_SOURCE_FILTER_BY_CATEGORY: Partial<Record<FilesTabs, ResourceSourceFilter>> = {
  [FilesTabs.Images]: ResourceSourceFilter.Generated,
};

export const canFilterResourceSource = ({ category, libraryId }: State): boolean =>
  !libraryId && SOURCE_FILTER_CATEGORIES.includes(category);

/**
 * The origin narrowing actually in effect: the user's explicit pick, else the
 * category default. A library defines its own pool and never narrows by origin.
 */
export const getResourceSourceFilter = (s: State): ResourceSourceFilter => {
  if (!canFilterResourceSource(s)) return ResourceSourceFilter.All;

  return (
    s.sourceFilter ?? DEFAULT_SOURCE_FILTER_BY_CATEGORY[s.category] ?? ResourceSourceFilter.All
  );
};

/**
 * Query of the explorer's search overlay, or `null` while no keyword is typed.
 * The overlay lists these rows and a select-all resolves against the same
 * params, so a batch action acts on the search results, never on the folder
 * list behind the overlay.
 */
export const getExplorerSearchParams = (s: State): ExplorerSearchParams | null => {
  if (!s.searchQuery) return null;

  return {
    category: s.libraryId ? undefined : s.category,
    includeContentPreview: s.viewMode === 'masonry',
    libraryId: s.libraryId,
    pageSize: DEFAULT_SEARCH_PAGE_SIZE,
    q: s.searchQuery,
    sorter: s.sorter,
    sortType: s.sortType,
    sourceFilter: getResourceSourceFilter(s),
    visibility: getResourceQueryVisibility(s.libraryId, s.listVisibility),
  };
};

/**
 * Default order for the current resource surface.
 */
export const getDefaultLibrarySort = (
  libraryId?: string,
): { sorter: 'custom' | 'createdAt'; sortType: SortType } =>
  libraryId
    ? { sorter: 'custom', sortType: SortType.Asc }
    : { sorter: 'createdAt', sortType: SortType.Desc };

export const sortFileList = <T extends Parameters<typeof compareResourceItems>[0]>(
  fileList: T[] | undefined,
  sorter: ResourceSorter,
  sortType: SortType,
  options?: { groupFolders?: boolean },
): T[] | undefined =>
  fileList?.toSorted((a, b) => compareResourceItems(a, b, sorter, sortType, options));

/**
 * Get sorted file list based on current sort settings
 * Reads from FileStore and applies sorting from ResourceManagerStore
 * @deprecated Use sortFileList with data from SWR hook instead
 */
const getSortedFileList = (s: State): FileListItem[] | undefined => {
  const fileList = useFileStore.getState().fileList;
  return sortFileList(fileList, s.sorter, s.sortType, { groupFolders: Boolean(s.libraryId) });
};

/**
 * Get current file by ID from FileStore
 * Returns undefined if no currentViewItemId or file not found
 */
const getCurrentFile = (s: State): FileListItem | undefined => {
  if (!s.currentViewItemId) return undefined;
  return fileManagerSelectors.getFileById(s.currentViewItemId)(useFileStore.getState());
};

const isFilePreviewMode = (s: State) => s.mode === 'editor' && !!s.currentViewItemId;

export const isExplorerItemSelected = ({
  id,
  selectAllState,
  selectedIds,
}: {
  id: string;
  selectAllState: SelectAllState;
  selectedIds: string[];
}) => (selectAllState === 'all' ? !selectedIds.includes(id) : selectedIds.includes(id));

export const getExplorerSelectAllUiState = ({
  data,
  hasMore,
  selectAllState,
  selectedIds,
}: {
  data: Array<{ id: string }>;
  hasMore: boolean;
  selectAllState: SelectAllState;
  selectedIds: string[];
}) => {
  const fileCount = data.length;
  const selectedCount = data.filter((item) =>
    isExplorerItemSelected({ id: item.id, selectAllState, selectedIds }),
  ).length;
  const allLoadedSelected = fileCount > 0 && selectedCount === fileCount;

  return {
    allSelected: allLoadedSelected,
    indeterminate: selectedCount > 0 && !allLoadedSelected,
    showSelectAllHint: selectAllState !== 'none' && (hasMore || selectAllState === 'all'),
  };
};

export const getExplorerSelectedCount = ({
  selectAllState,
  selectedIds,
  total,
}: {
  selectAllState: SelectAllState;
  selectedIds: string[];
  total?: number;
}) => {
  if (selectAllState !== 'all') return selectedIds.length;
  if (typeof total !== 'number') return 0;

  return Math.max(total - selectedIds.length, 0);
};

export const selectors = {
  category: (s: State) => s.category,
  currentViewItemId: (s: State) => s.currentViewItemId,
  getCurrentFile,
  getSortedFileList,
  isFilePreviewMode,
  mode: (s: State) => s.mode,
};
