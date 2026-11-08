import type { LinearIssueStateType } from '@lobechat/types';

interface IssueFilterKeyParams {
  connectionId: string;
  includeArchived?: boolean;
  linearProjectId?: string | null;
  stateTypes: LinearIssueStateType[];
  teamId: string;
}

const issueFilterKey = (params: IssueFilterKeyParams) =>
  [
    params.connectionId,
    params.teamId,
    params.linearProjectId ?? null,
    [...params.stateTypes].sort().join(','),
    !!params.includeArchived,
  ] as const;

/**
 * SWR keys of the Linear integration. Kept beside the feature because the
 * central registry (`@/libs/swr/keys`) is over the file-size limit; they
 * follow its `'<domain>:<resource>'` convention.
 */
export const linearKeys = {
  config: () => ['linear:config'] as const,
  connections: (workspaceId: string | null | undefined) =>
    ['linear:connections', workspaceId ?? null] as const,
  issueCount: (params: IssueFilterKeyParams) =>
    ['linear:issueCount', ...issueFilterKey(params)] as const,
  issues: (params: IssueFilterKeyParams) => ['linear:issues', ...issueFilterKey(params)] as const,
  projects: (connectionId: string, teamId: string) =>
    ['linear:projects', connectionId, teamId] as const,
  syncRules: (projectId: string) => ['linear:syncRules', projectId] as const,
  syncJobs: (projectId: string) => ['linear:syncJobs', projectId] as const,
  teams: (connectionId: string) => ['linear:teams', connectionId] as const,
};
