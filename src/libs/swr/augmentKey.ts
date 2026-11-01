/**
 * Append the active workspace id to the SWR cache key so workspace-scoped
 * fetches never collide across contexts. Personal mode (no active workspace)
 * leaves the key unchanged so existing personal caches keep their identity.
 *
 * - `null` / `undefined` / `false` keys (SWR's "skip" signals) pass through.
 * - String / number keys are wrapped into a tuple `[key, wsId]`.
 * - Array keys get `wsId` appended.
 * - Other shapes (object keys, etc.) are wrapped into a tuple too.
 *
 * Used by both `useClientDataSWR` (subscriber side) and the scoped `mutate`
 * (invalidator side) so the two stay symmetric — otherwise a workspace-scoped
 * subscriber's key would never match the unaugmented key passed to mutate, and
 * revalidation calls would silently no-op (see `mutate.ts`).
 */
export const augmentKey = (key: unknown, workspaceId: string | null | undefined): unknown => {
  if (workspaceId == null) return key;
  if (key == null || key === false) return key;
  if (Array.isArray(key)) return [...key, workspaceId];
  return [key, workspaceId];
};
