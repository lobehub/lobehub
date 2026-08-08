import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ProjectService {
  acceptCompletion = async (id: string, comment?: string) =>
    lambdaClient.project.acceptCompletion.mutate({ comment, id });

  list = async (params: { limit?: number; offset?: number; statuses?: ProjectStatus[] } = {}) =>
    lambdaClient.project.list.query({ limit: 50, offset: 0, ...params });

  detail = async (id: string) => lambdaClient.project.detail.query({ id });

  create = async (params: {
    avatar?: string;
    description?: string;
    identifier: string;
    name: string;
    visibility?: ProjectVisibility;
  }) => lambdaClient.project.create.mutate(params);

  rejectCompletion = async (id: string, comment: string) =>
    lambdaClient.project.rejectCompletion.mutate({ comment, id });

  reopen = async (id: string) => lambdaClient.project.reopen.mutate({ id });

  requestCompletion = async (id: string) => lambdaClient.project.requestCompletion.mutate({ id });

  updateStatus = async (id: string, status: 'active' | 'archived' | 'backlog' | 'paused') =>
    lambdaClient.project.updateStatus.mutate({ id, status });
}

export const projectService = new ProjectService();
