import type { LinearIssueStateType } from '@lobechat/types';

/**
 * SWR keys of the Linear integration. Kept beside the feature because the
 * central registry (`@/libs/swr/keys`) is over the file-size limit; they
 * follow its `'<domain>:<resource>'` convention.
 */
export const linearKeys = {
  config: () => ['linear:config'] as const,
  connections: (workspaceId: string | null | undefined) =>
    ['linear:connections', workspaceId ?? null] as const,
  issues: (params: {
    connectionId: string;
    linearProjectId?: string | null;
    stateTypes: LinearIssueStateType[];
    teamId: string;
  }) =>
    [
      'linear:issues',
      params.connectionId,
      params.teamId,
      params.linearProjectId ?? null,
      [...params.stateTypes].sort().join(','),
    ] as const,
  projects: (connectionId: string, teamId: string) =>
    ['linear:projects', connectionId, teamId] as const,
  syncRules: (projectId: string) => ['linear:syncRules', projectId] as const,
  syncJobs: (projectId: string) => ['linear:syncJobs', projectId] as const,
  teams: (connectionId: string) => ['linear:teams', connectionId] as const,
};
