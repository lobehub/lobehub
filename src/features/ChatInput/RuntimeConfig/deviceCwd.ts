/** Max number of recent working directories persisted per device. Matches the
 * `recentCwds` cap enforced by the `device.updateDevice` tRPC input. */
export const RECENT_CWDS_MAX = 20;

/**
 * Compute the next `recentCwds` list after the user picks `cwd`: move it to the
 * front (most-recent-first), drop any earlier duplicate, and cap the length.
 * Blank paths are ignored (returns the list unchanged).
 *
 * The server stores `recentCwds` verbatim — there is no server-side dedupe or
 * cap — so the client owns this logic.
 */
export const nextRecentCwds = (
  cwd: string,
  current: readonly string[] = [],
  max: number = RECENT_CWDS_MAX,
): string[] => {
  const trimmed = cwd.trim();
  if (!trimmed) return [...current];
  return [trimmed, ...current.filter((p) => p !== trimmed)].slice(0, max);
};
