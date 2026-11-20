import type { WorkspaceUserPreference } from '@lobechat/types';

import { defineReplica, type ReplicaResource } from '@/libs/replica';

export interface WorkspaceUserPreferenceParams {
  /** The currently-active workspace; the preference row is one per workspace. */
  workspaceId: string;
}

type WorkspaceUserPreferenceResource = ReplicaResource<
  WorkspaceUserPreferenceParams,
  WorkspaceUserPreference,
  WorkspaceUserPreference | null
>;

let resource: WorkspaceUserPreferenceResource | undefined;

/**
 * The caller's `workspace_user_settings.preference` bucket of one workspace,
 * keyed by the active `workspaceId` (`workspaceUserPreference` is its view).
 *
 * The identity partition (`${userId}:${workspaceId}`) already owns the
 * workspace boundary — switching workspaces is a scope change, so a projection
 * is read and revalidated for the right workspace without the fetcher naming it
 * (the tRPC context carries the workspace).
 *
 * Persisted to IndexedDB so a reload paints the member's last-known preference
 * from the local copy instead of the empty bucket, with the network only
 * confirming it. The fetched value may be `null` when the workspace has no row
 * yet; the view folds that to the empty bucket.
 *
 * Built lazily on purpose: `@/libs/replica` reaches `@/store/user` through its
 * cache-scope wiring (`useCacheScope`), so the user store must not evaluate
 * this resource while its own module (and store) is being created — that would
 * read `@/libs/replica`'s exports mid-cycle. Resolving the binding on first use
 * is safe in both import orders: whether the user store or `@/libs/replica`
 * loads first, both modules have settled by then.
 */
export const getWorkspaceUserPreferenceResource = (): WorkspaceUserPreferenceResource =>
  (resource ??= defineReplica<
    WorkspaceUserPreferenceParams,
    WorkspaceUserPreference,
    WorkspaceUserPreference | null
  >({
    key: ({ workspaceId }) => workspaceId,
    name: 'workspaceUserSettings',
    storage: 'indexedDB',
    version: 1,
  }));
