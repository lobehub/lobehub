export interface RouteBoundaryState {
  error?: Error;
  resetKey: string;
}

/**
 * The location identity the boundary resets on. Pathname alone is not enough:
 * the community lists derive their SWR keys from the query string, so a failed
 * page / filter / ordering request has to clear when the user moves to a
 * different query on the same path.
 */
export const routeResetKey = (pathname: string, search: string) => `${pathname}${search}`;

/**
 * Clear a stale failure when the route changes, without remounting the healthy
 * subtree — the boundary lives in a persistent area layout, so keying it would
 * throw away the scroll position and local state of every route it wraps.
 */
export const resetOnLocationChange = (
  resetKey: string,
  state: RouteBoundaryState,
): RouteBoundaryState | null => {
  if (resetKey === state.resetKey) return null;

  return { error: undefined, resetKey };
};
