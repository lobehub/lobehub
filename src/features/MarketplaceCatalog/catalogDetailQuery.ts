/** Keep the current catalogue filters when entering or leaving an installed item's detail. */
export const catalogDetailQuery = (params: URLSearchParams, selection?: string) => {
  const next = new URLSearchParams(params);
  next.delete('skill'); // Legacy skill deep links must also close on Back.
  if (selection) next.set('open', selection);
  else next.delete('open');
  return next;
};
