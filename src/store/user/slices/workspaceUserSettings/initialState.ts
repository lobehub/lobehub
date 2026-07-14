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
}

export const initialWorkspaceUserSettingsState: WorkspaceUserSettingsState = {
  workspaceUserPreference: {},
};
