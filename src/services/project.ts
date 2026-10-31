import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';

import { createWorkspaceLambdaClient, lambdaClient } from '@/libs/trpc/client';

const PROJECT_PAGE_SIZE = 100;

export interface ProjectAgentBindingPatch {
  enabled?: boolean;
  responsibility?: string | null;
  role?: string | null;
  sortOrder?: number;
}

export interface ProjectKnowledgeBaseBindingPatch {
  enabled?: boolean;
  sortOrder?: number;
}

class ProjectService {
  acceptCompletion = async (id: string, comment?: string) =>
    lambdaClient.project.acceptCompletion.mutate({ comment, id });

  addAgent = async (id: string, agentId: string, patch: ProjectAgentBindingPatch = {}) =>
    lambdaClient.project.addAgent.mutate({ agentId, id, ...patch });

  addKnowledgeBase = async (
    id: string,
    knowledgeBaseId: string,
    patch: ProjectKnowledgeBaseBindingPatch = {},
  ) => lambdaClient.project.addKnowledgeBase.mutate({ id, knowledgeBaseId, ...patch });

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

  move = async (id: string, anchor: { afterId: string } | { beforeId: string }) =>
    lambdaClient.project.move.mutate({ id, ...anchor });

  create = async (
    params: {
      avatar?: string;
      coordinatorAgentId?: string;
      description?: string;
      identifier?: string;
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

  removeAgent = async (id: string, agentId: string) =>
    lambdaClient.project.removeAgent.mutate({ agentId, id });

  removeKnowledgeBase = async (id: string, knowledgeBaseId: string) =>
    lambdaClient.project.removeKnowledgeBase.mutate({ id, knowledgeBaseId });

  replaceCoordinator = async (id: string, agentId: string) =>
    lambdaClient.project.replaceCoordinator.mutate({ agentId, id });

  reopen = async (id: string) => lambdaClient.project.reopen.mutate({ id });

  requestCompletion = async (id: string) => lambdaClient.project.requestCompletion.mutate({ id });

  update = async (
    id: string,
    input: {
      avatar?: string | null;
      description?: string | null;
      name?: string;
      slug?: string | null;
    },
  ) => lambdaClient.project.update.mutate({ id, ...input });

  updateAgent = async (id: string, agentId: string, patch: ProjectAgentBindingPatch) =>
    lambdaClient.project.updateAgent.mutate({ agentId, id, ...patch });

  updateKnowledgeBase = async (
    id: string,
    knowledgeBaseId: string,
    patch: ProjectKnowledgeBaseBindingPatch,
  ) => lambdaClient.project.updateKnowledgeBase.mutate({ id, knowledgeBaseId, ...patch });

  updateStatus = async (id: string, status: 'active' | 'archived' | 'backlog' | 'paused') =>
    lambdaClient.project.updateStatus.mutate({ id, status });
}

export const projectService = new ProjectService();
