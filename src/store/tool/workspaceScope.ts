import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

/**
 * Workspace scoping for the tool store.
 *
 * The tool store is a module-level singleton that survives the workspace-switch
 * remount, while most of its buckets hold data the server already filtered by
 * the active workspace. Keeping them correct used to rest entirely on a
 * procedural convention: whoever adds a bucket must also register a reset hook
 * (`registerWorkspaceScopedSlice`). Forgetting that made the store render the
 * PREVIOUS workspace's data — a fail-OPEN default, and one that has already
 * been missed for `connectors`, `composioServers` and `lobehubSkillServers`.
 *
 * So buckets now carry the scope they were fetched under, and selectors refuse
 * data that does not match the active workspace. Forgetting to register a reset
 * now degrades to an empty list that the next fetch fills in, instead of
 * silently showing another workspace's integrations.
 *
 * The reset hooks are still worth registering — they clear stale data eagerly
 * so the switch doesn't flash an empty panel — but they are an optimization
 * now, not the thing correctness depends on.
 */

/** Scope key standing in for "no workspace", so a missing entry stays distinguishable. */
export const PERSONAL_SCOPE_KEY = '__personal__';

/** Tool-store buckets whose contents are workspace-dimensioned. */
export type ScopedToolBucket =
  'agentSkills' | 'composioServers' | 'connectors' | 'lobehubSkillServers';

export interface ToolBucketScopeState {
  /**
   * Workspace each bucket's current contents were fetched under. An absent
   * entry is read as personal scope — see {@link isBucketInScope}.
   */
  toolBucketScopes: Partial<Record<ScopedToolBucket, string>>;
}

export const initialToolBucketScopeState: ToolBucketScopeState = {
  toolBucketScopes: {},
};

/** Scope key for the workspace the user is currently in. */
export const currentScopeKey = (): string => getActiveWorkspaceId() ?? PERSONAL_SCOPE_KEY;

/**
 * Stamp a bucket with the scope its freshly-written contents belong to. Call
 * this in the same `set` that writes the data, so the two can never drift.
 */
export const markBucketScope = (
  scopes: ToolBucketScopeState['toolBucketScopes'],
  bucket: ScopedToolBucket,
): ToolBucketScopeState['toolBucketScopes'] => ({ ...scopes, [bucket]: currentScopeKey() });

/**
 * Whether a bucket's contents were fetched under the workspace now active.
 *
 * An unstamped bucket counts as personal. That keeps the guard aimed at the
 * leak that actually happens — data fetched in one scope surfacing inside a
 * DIFFERENT workspace — without making every state object that predates the
 * stamp (open-source callers, existing test fixtures, the no-workspace
 * deployment) read as empty. Data fetched in a workspace is always stamped, so
 * it still cannot leak back into the personal view.
 */
export const isBucketInScope = (state: ToolBucketScopeState, bucket: ScopedToolBucket): boolean =>
  (state.toolBucketScopes?.[bucket] ?? PERSONAL_SCOPE_KEY) === currentScopeKey();

/**
 * Shared empty result. Selectors must return a stable reference for
 * out-of-scope buckets — a fresh `[]` each call would defeat zustand's
 * equality check and re-render on every store update.
 */
const EMPTY: readonly never[] = Object.freeze([]);

/**
 * Read a bucket, or an empty list when its contents belong to another
 * workspace. Wrap every selector that exposes scoped bucket data.
 */
export const scopedBucket = <T>(
  state: ToolBucketScopeState,
  bucket: ScopedToolBucket,
  items: T[] | undefined,
): T[] => (isBucketInScope(state, bucket) ? (items ?? (EMPTY as T[])) : (EMPTY as T[]));
