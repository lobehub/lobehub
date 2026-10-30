/**
 * Footer for offset-paged `list` commands, telling a reader (or a script) where
 * the page sits and whether to keep going. With a `total` it reports the exact
 * position; without one, a short page means the list is exhausted, so a full
 * page always points at the next one (which may then come back empty).
 */
export function formatPageFooter(params: {
  count: number;
  page: number;
  pageSize: number;
  total?: number;
}): string {
  const { count, page, pageSize, total } = params;
  const first = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const range = count === 0 ? '0' : `${first}-${first + count - 1}`;

  if (typeof total !== 'number') {
    const next = count < pageSize ? ' · no more pages' : ` · next: --page ${page + 1}`;
    return `Page ${page} · ${range}${next}`;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (count === 0 && page > totalPages) {
    return `Page ${page} is past the end · ${total} total · last page: --page ${totalPages}`;
  }
  const next = page < totalPages ? ` · next: --page ${page + 1}` : ' · no more pages';
  return `Page ${page}/${totalPages} · ${range} of ${total}${next}`;
}
