/**
 * First page of the comment list. Header (Reviews stat) and the Reviews tab
 * must query with the SAME params so SWR dedupes them into one request — the
 * header count doubles as a prefetch for the tab.
 */
export const FIRST_COMMENTS_PAGE_QUERY = {
  order: 'desc',
  page: 1,
  sort: 'createdAt',
} as const;
