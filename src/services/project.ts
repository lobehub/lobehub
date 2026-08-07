import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class ProjectService {
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
}

export const projectService = new ProjectService();
