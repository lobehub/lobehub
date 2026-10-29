import type { LinearIssueStateType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface LinearIssueFilterParams {
  connectionId: string;
  linearProjectId?: string | null;
  stateTypes: LinearIssueStateType[];
  teamId: string;
}

class LinearService {
  disconnect = async (connectionId: string) =>
    lambdaClient.linear.disconnect.mutate({ connectionId });

  getConfig = async () => lambdaClient.linear.getConfig.query();

  listConnections = async () => lambdaClient.linear.listConnections.query();

  // ── Issue sync ──

  listTeams = async (connectionId: string) => lambdaClient.linear.listTeams.query({ connectionId });

  listProjects = async (connectionId: string, teamId: string) =>
    lambdaClient.linear.listProjects.query({ connectionId, teamId });

  listIssues = async (params: LinearIssueFilterParams & { cursor?: string }) =>
    lambdaClient.linear.listIssues.query(params);

  /** Starts a background import; returns the job id. */
  startImport = async (params: { connectionId: string; issueIds: string[]; projectId: string }) =>
    lambdaClient.linear.startImport.mutate(params);

  listSyncJobs = async (projectId: string) => lambdaClient.linear.listSyncJobs.query({ projectId });

  listSyncRules = async (projectId: string) =>
    lambdaClient.linear.listSyncRules.query({ projectId });

  createSyncRule = async (
    params: LinearIssueFilterParams & {
      linearProjectName?: string | null;
      projectId: string;
      teamName: string;
    },
  ) => lambdaClient.linear.createSyncRule.mutate(params);

  deleteSyncRule = async (ruleId: string) => lambdaClient.linear.deleteSyncRule.mutate({ ruleId });

  /** Starts a background run of a saved rule; returns the job id. */
  startRuleSync = async (ruleId: string) => lambdaClient.linear.startRuleSync.mutate({ ruleId });
}

export const linearService = new LinearService();
