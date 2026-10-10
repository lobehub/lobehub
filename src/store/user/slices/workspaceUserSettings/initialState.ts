import type { WorkspaceUserPreference } from '@lobechat/types';

import type { ReplicaState } from '@/libs/replica';

/**
 * Replica-backed copy of the caller's `workspace_user_settings.preference`
 * row for the currently-active workspace (see
 * `getWorkspaceUserPreferenceResource`). The replica is keyed on the active
 * `workspaceId` and partitioned by the identity scope, so switching workspaces
 * drops the previous workspace's bucket before paint and reads the right one.
 */
export interface WorkspaceUserSettingsState {
  /**
   * The active workspace's preference bucket — the replica view. Empty on
   * first load / while the local copy is being read / in personal mode.
   * Consumers treat empty as "no override — use the shared defaults",
   * identical to the pre-migration behaviour.
   */
  workspaceUserPreference: WorkspaceUserPreference;
  /** Replica bookkeeping for `workspaceUserPreference` (see `getWorkspaceUserPreferenceResource`). */
  workspaceUserPreferenceReplica: ReplicaState<WorkspaceUserPreference>;
  /**
   * The workspace whose preference row `workspaceUserPreference` currently
   * holds, or `null` before the first hydrate/fetch resolves. Lets consumers
   * tell "loaded and empty" apart from "not fetched yet" (e.g. the sidebar
   * bridge must not clear the overlay until the active workspace's row has
   * loaded — see `workspaceUserSettingsSelectors.preferenceWorkspaceId`).
   */
  workspaceUserPreferenceWorkspaceId: string | null;
}

export const initialWorkspaceUserSettingsState: WorkspaceUserSettingsState = {
  workspaceUserPreference: {},
  workspaceUserPreferenceWorkspaceId: null,
  // The literal is the same `{ entries: {} }` `createReplicaState()` returns,
  // written out because `@/libs/replica` imports `@/store/user` through its
  // cache-scope wiring: evaluating that module while the user store initializes
  // its own state is a cycle (see `projection.ts`).
  workspaceUserPreferenceReplica: { entries: {} },
};
