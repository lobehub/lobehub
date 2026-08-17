import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';

import { createWorkspaceLambdaClient, lambdaClient } from '@/libs/trpc/client';

const PROJECT_PAGE_SIZE = 100;

class ProjectService {
  acceptCompletion = async (id: string, comment?: string) =>
    lambdaClient.project.acceptCompletion.mutate({ comment, id });

  listAll = async (params: { statuses?: ProjectStatus[] } = {}) => {
    const projects = [];
    let offset = 0;
    let response;

    do {
      response = await lambdaClient.project.list.query({
        limit: PROJECT_PAGE_SIZE,
        offset,
        ...params,
      });
      projects.push(...response.data);
      offset += response.data.length;
    } while (response.data.length === PROJECT_PAGE_SIZE);

    return { ...response, data: projects };
  };

  detail = async (id: string) => lambdaClient.project.detail.query({ id });

  delete = async (id: string) => lambdaClient.project.delete.mutate({ id });

  create = async (
    params: {
      avatar?: string;
      description?: string;
      identifier: string;
      name: string;
      slug?: string;
      visibility?: ProjectVisibility;
    },
    workspaceId?: string | null,
  ) =>
    (workspaceId ? createWorkspaceLambdaClient(workspaceId) : lambdaClient).project.create.mutate(
      params,
    );

  rejectCompletion = async (id: string, comment: string) =>
    lambdaClient.project.rejectCompletion.mutate({ comment, id });

  reopen = async (id: string) => lambdaClient.project.reopen.mutate({ id });

  requestCompletion = async (id: string) => lambdaClient.project.requestCompletion.mutate({ id });

  update = async (id: string, input: { name?: string }) =>
    lambdaClient.project.update.mutate({ id, ...input });

  updateStatus = async (id: string, status: 'active' | 'archived' | 'backlog' | 'paused') =>
    lambdaClient.project.updateStatus.mutate({ id, status });
}

export const projectService = new ProjectService();
