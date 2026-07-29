import type { WorkspaceUserPreference } from '@lobechat/types';

/**
 * Cached copy of the caller's `workspace_user_settings.preference` row for
 * the currently-active workspace. Refreshed via SWR keyed on the active
 * `workspaceId`, so switching workspaces auto-refetches the right bucket.
 */
export interface WorkspaceUserSettingsState {
  /**
   * Empty on first load / while SWR is fetching / when the caller is in
   * personal mode. Consumers should treat empty as "no override — use the
   * shared defaults", identical to the pre-LOBE-11689 behaviour.
   */
  workspaceUserPreference: WorkspaceUserPreference;
  /**
   * The workspace whose preference row `workspaceUserPreference` currently
   * holds, or `null` before the first fetch resolves. Lets consumers tell
   * "loaded and empty" apart from "not fetched yet" (e.g. the sidebar bridge
   * must not clear the overlay until the active workspace's row has loaded).
   */
  workspaceUserPreferenceWorkspaceId: string | null;
}

export const initialWorkspaceUserSettingsState: WorkspaceUserSettingsState = {
  workspaceUserPreference: {},
  workspaceUserPreferenceWorkspaceId: null,
};
