import { type ResourceItem, type ResourceQueryParams } from '@/types/resource';

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

const toTime = (value: Date | string | number | undefined | null) =>
  value == null ? 0 : new Date(value).getTime();

const SORT_ACCESSORS: Record<string, (item: ResourceItem) => number | string> = {
  createdAt: (item) => toTime(item.createdAt),
  name: (item) => item.name ?? '',
  size: (item) => item.size ?? 0,
  updatedAt: (item) => toTime(item.updatedAt),
};

/**
 * The order the server returns a list in, mirrored from the knowledge
 * repository's `orderBy`: both `sorter` and `sortType` have to be present for a
 * custom sort, anything else is newest-first.
 */
const compareResourcesForList =
  ({ sorter, sortType }: ResourceListParams) =>
  (a: ResourceItem, b: ResourceItem) => {
    const custom = sorter && sortType && sorter in SORT_ACCESSORS;
    const accessor = custom ? SORT_ACCESSORS[sorter!] : SORT_ACCESSORS.createdAt;
    const direction = custom && String(sortType).toLowerCase() === 'asc' ? 1 : -1;

    const left = accessor(a);
    const right = accessor(b);
    const order =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right)
        : Number(left) - Number(right);
    return order * direction;
  };

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
