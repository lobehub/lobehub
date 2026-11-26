import qs from 'query-string';

/** How many items a Discover group previews: three rows of the two-column grid. */
export const CATALOG_SECTION_SIZE = 6;

/** Page size of a full group list; even, so the two-column grid has no gap. */
export const CATALOG_LIST_PAGE_SIZE = 24;

export interface CatalogCategoryOption<K extends string = string> {
  key: K;
  label: string;
}

export interface CatalogCategoryCount {
  category: string;
  count: number;
}

/**
 * The category groups of the Discover page: categories that have items, the
 * largest first (ties keep the configured order). `exclude` drops the pseudo
 * categories (`all`, `discover`) that are not a group of their own.
 * Before the counts load there is nothing to order, so no group is shown.
 */
export const orderCategoriesByCount = <K extends string>(
  categories: CatalogCategoryOption<K>[],
  counts: CatalogCategoryCount[],
  exclude: readonly string[] = [],
): (CatalogCategoryOption<K> & { count: number })[] => {
  const countByKey = new Map(counts.map((item) => [item.category, item.count || 0]));

  return categories
    .filter((item) => !exclude.includes(item.key))
    .map((item, index) => ({ ...item, count: countByKey.get(item.key) ?? 0, index }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ index: _index, ...item }) => item);
};

/** The full list behind a group heading: the Discover path with its query. */
export const buildCatalogListUrl = (
  path: string,
  query: { category?: string; group?: string; q?: string; sort?: string; source?: string },
): string => qs.stringifyUrl({ query, url: path }, { skipEmptyString: true, skipNull: true });

/**
 * The Discover page shows groups until the user narrows it: a category, a sort,
 * or a page number turns it into one full list.
 */
export const isCatalogListView = (query: {
  category?: string;
  page?: number | string;
  sort?: string;
}): boolean => Boolean(query.category || query.sort || query.page);

/** Editing a search keeps its current group and sort, but starts at page one. */
export const catalogSearchParams = (params: URLSearchParams, keyword: string): URLSearchParams => {
  const next = new URLSearchParams(params);
  const query = keyword.trim();
  next.delete('page');
  if (query) next.set('q', query);
  else next.delete('q');
  return next;
};
