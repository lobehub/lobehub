import type { WorkspaceUserPreference } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Client-side accessor for the caller's preferences inside the current
 * workspace. Mirrors `UserService.updatePreference` but for the
 * workspace-scoped bucket. Consumers should not call these when the caller
 * is in personal mode — the server rejects the request there.
 */
export class WorkspaceUserSettingsService {
  getPreference = async (): Promise<WorkspaceUserPreference> => {
    return lambdaClient.workspaceUserSettings.getPreference.query();
  };

  updatePreference = async (patch: Partial<WorkspaceUserPreference>): Promise<void> => {
    await lambdaClient.workspaceUserSettings.updatePreference.mutate(patch);
  };

  /** One directory's "New worktree" switch; resolves to the stored (capped) list. */
  setWorktreeModeDir = async (key: string, enabled: boolean): Promise<string[]> =>
    lambdaClient.workspaceUserSettings.setWorktreeModeDir.mutate({ enabled, key });
}

export const workspaceUserSettingsService = new WorkspaceUserSettingsService();
