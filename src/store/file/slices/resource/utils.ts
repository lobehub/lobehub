import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';

import { SortType } from '@/types/files';
import { type ResourceItem, type ResourceQueryParams, type ResourceSorter } from '@/types/resource';

import { type ResourceListParams, type ResourceListValue } from './projection';

/**
 * Query fields that select a different *pool* of resources rather than a
 * different arrangement of the same one. Changing any of them is a navigation:
 * the rows on screen stop being an answer to the question now being asked, so
 * the views show a skeleton instead of the stale list. `sorter` / `sortType` /
 * `q` are deliberately absent — they re-ask the same pool.
 *
 * Lives here (not in the Explorer) so every consumer of "what counts as a
 * navigation" reads one list.
 */
export const RESOURCE_POOL_KEYS = [
  'category',
  'libraryId',
  'parentId',
  'sourceFilter',
  'visibility',
] as const satisfies readonly (keyof ResourceQueryParams)[];

/**
 * Stable identity of one explorer list query. The replica now owns query
 * identity via `resourceListResource.query`; this is kept for the document
 * slice, which stamps `ResourceItem._optimistic.queryKey` with it.
 */
export const getResourceQueryKey = (params?: ResourceQueryParams | null) => {
  if (!params) return 'resource-query:default';

  return JSON.stringify({
    category: params.category ?? null,
    libraryId: params.libraryId ?? null,
    parentId: params.parentId ?? null,
    q: params.q ?? null,
    showFilesInKnowledgeBase: params.showFilesInKnowledgeBase ?? null,
    sorter: params.sorter ?? null,
    sortType: params.sortType ?? null,
  });
};

/**
 * The pool fields an optimistic row's `_optimistic.queryKey` carries (see
 * `getResourceQueryKey`). `sourceFilter` / `visibility` are not part of the row
 * key, but those switches clear the painted rows outright, so a surviving
 * client-only row only ever needs re-checking against these.
 */
const OPTIMISTIC_POOL_FIELDS = ['category', 'libraryId', 'parentId'] as const;

/**
 * Whether a locally inserted row (an in-flight upload / create) belongs to the
 * pool the Explorer is showing. A head refresh for the same pool must keep it —
 * even a re-sort or a view-mode change — while a refresh for another folder or
 * library must not surface it there.
 */
export const isOptimisticRowInRequestedPool = (
  queryKey: string | undefined,
  params?: ResourceListParams | null,
): boolean => {
  if (!queryKey) return false;

  try {
    const parsed = JSON.parse(queryKey) as Record<string, unknown>;
    return OPTIMISTIC_POOL_FIELDS.every(
      (field) => (parsed[field] ?? null) === (params?.[field] ?? null),
    );
  } catch {
    return false;
  }
};

// ---- move reconciliation into cached folder lists ------------------------

const formatNumericToken = (digits: string): string => {
  const trimmed = digits.replace(/^0+/, '') || '0';
  return trimmed.length <= 20
    ? trimmed.padStart(20, '0')
    : `99999999999999999999:${String(trimmed.length).padStart(10, '0')}:${trimmed}`;
};

export const toNaturalSortKey = (value: string): string => {
  const lower = value.toLowerCase();
  return `${lower.replaceAll(/\d+/g, formatNumericToken)}\u0001${lower}`;
};

// PostgreSQL's UTF-8 COLLATE "C" compares code points, not UTF-16 code units.
const compareCodePoints = (a: string, b: string): number => {
  let aIndex = 0;
  let bIndex = 0;
  while (aIndex < a.length && bIndex < b.length) {
    const aPoint = a.codePointAt(aIndex)!;
    const bPoint = b.codePointAt(bIndex)!;
    if (aPoint !== bPoint) return aPoint - bPoint;
    aIndex += aPoint > 0xffff ? 2 : 1;
    bIndex += bPoint > 0xffff ? 2 : 1;
  }
  return Number(aIndex < a.length) - Number(bIndex < b.length);
};

type SortableResource = {
  createdAt?: Date | string | null;
  fileType?: string;
  id: string;
  isFolder?: boolean;
  metadata?: Record<string, unknown> | null;
  name?: string | null;
  size?: number | null;
};

const toTime = (value?: Date | string | null): number => {
  const time = value == null ? 0 : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

/** Shared ordering for Explorer, sidebar and cached destination lists. */
export const compareResourceItems = (
  a: SortableResource,
  b: SortableResource,
  sorter: ResourceSorter,
  sortType: SortType,
  options?: { groupFolders?: boolean },
): number => {
  const aFolder = a.isFolder === true || a.fileType === CUSTOM_FOLDER_FILE_TYPE;
  const bFolder = b.isFolder === true || b.fileType === CUSTOM_FOLDER_FILE_TYPE;
  const groupFolders = (options?.groupFolders ?? true) || sorter === 'custom' || sorter === 'name';
  if (groupFolders && aFolder !== bFolder) return aFolder ? -1 : 1;

  const direction = sortType === SortType.Desc ? -1 : 1;
  let cmp = 0;
  if (sorter === 'custom') {
    const aOrder = a.metadata?.sortOrder;
    const bOrder = b.metadata?.sortOrder;
    const aHasOrder = typeof aOrder === 'number' && Number.isFinite(aOrder);
    const bHasOrder = typeof bOrder === 'number' && Number.isFinite(bOrder);
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
    if (aHasOrder && bHasOrder) cmp = aOrder - bOrder;
  } else if (sorter === 'size') {
    cmp = (a.size ?? 0) - (b.size ?? 0);
  } else if (sorter === 'createdAt') {
    cmp = toTime(a.createdAt) - toTime(b.createdAt);
  }
  const ordered =
    (cmp || compareCodePoints(toNaturalSortKey(a.name ?? ''), toNaturalSortKey(b.name ?? ''))) *
    direction;
  return ordered || compareCodePoints(a.id, b.id);
};

const compareResourcesForList =
  ({ libraryId, sorter, sortType }: ResourceListParams) =>
  (a: ResourceItem, b: ResourceItem) =>
    compareResourceItems(
      a,
      b,
      sorter ?? (libraryId ? 'custom' : 'createdAt'),
      sortType ?? (libraryId ? SortType.Asc : SortType.Desc),
      { groupFolders: Boolean(libraryId) },
    );

/**
 * Whether a cached list is a plain folder listing the moved row certainly
 * belongs to. A list narrowed by a keyword, a category tab, a source chip or a
 * visibility mode may or may not include the row, and the server owns those
 * rules; such variants are left for revalidation rather than seeded with a row
 * that might not match. The personal root's default `showFilesInKnowledgeBase:
 * false` hides library rows, so a row that belongs to a library stays out.
 */
export const listsMovedRowUnfiltered = (
  params: ResourceListParams,
  resource: ResourceItem,
): boolean => {
  if (params.q?.trim()) return false;
  if (params.category && params.category !== 'all') return false;
  if (params.sourceFilter && params.sourceFilter !== 'all') return false;
  if (params.visibility) return false;
  if (!params.libraryId && !params.showFilesInKnowledgeBase && resource.knowledgeBaseId) {
    return false;
  }
  // The drive lists uploaded files and the folders that hold them; a page row is
  // never part of it.
  if (
    params.filesOnly &&
    resource.sourceType === 'document' &&
    resource.fileType !== CUSTOM_FOLDER_FILE_TYPE
  ) {
    return false;
  }

  return true;
};

/** Drop the moved row from a list it no longer belongs to (a source folder). */
export const patchSourceList = (data: ResourceListValue, movedId: string): ResourceListValue => {
  const items = data.items.filter((item) => item.id !== movedId);
  if (items.length === data.items.length) return data;

  return {
    ...data,
    items,
    hasMore: data.total === undefined ? data.hasMore : data.total - 1 > items.length,
    total: data.total === undefined ? undefined : Math.max(items.length, data.total - 1),
  };
};

/**
 * Put the moved row where the server would list it. A cached page keeps its
 * length: `loadMore` derives the next `offset` from the cached row count, so a
 * page that grew past its limit would make "load more" skip a server row. On a
 * full page the row is either placed in order (the row that falls off the end
 * reappears at that same server offset) or, when it sorts past everything
 * cached, left for the later page that will contain it.
 */
export const patchDestinationList = (
  data: ResourceListValue,
  movedResource: ResourceItem,
  params: ResourceListParams,
): ResourceListValue => {
  const remaining = data.items.filter((item) => item.id !== movedResource.id);
  const removed = data.items.length - remaining.length;
  const total = data.total === undefined ? undefined : data.total - removed + 1;

  const compare = compareResourcesForList(params);
  const position = remaining.findIndex((item) => compare(movedResource, item) < 0);
  const inserted =
    position === -1
      ? [...remaining, movedResource]
      : [...remaining.slice(0, position), movedResource, ...remaining.slice(position)];

  const pageLength = data.items.length;
  if (!data.hasMore || inserted.length <= pageLength) {
    return { ...data, items: inserted, total };
  }

  return {
    ...data,
    items: position === -1 ? remaining : inserted.slice(0, pageLength),
    total,
  };
};
