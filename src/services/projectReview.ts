import type { ProjectMemberRole } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export type ProjectSiteList = Awaited<
  ReturnType<typeof lambdaClient.projectReview.listSites.query>
>;
export type ProjectSiteItem = ProjectSiteList[number];
export type ProjectMemberList = Awaited<
  ReturnType<typeof lambdaClient.projectReview.listMembers.query>
>;
export type ProjectMemberItem = ProjectMemberList['members'][number];

export interface ProjectSiteInput {
  name: string;
  origins: string[];
}

class ProjectReviewService {
  createSite = (projectId: string, input: ProjectSiteInput) =>
    lambdaClient.projectReview.createSite.mutate({ projectId, ...input });

  deleteSite = (id: string) => lambdaClient.projectReview.deleteSite.mutate({ id });

  listMembers = (projectId: string) => lambdaClient.projectReview.listMembers.query({ projectId });

  listSites = (projectId: string) => lambdaClient.projectReview.listSites.query({ projectId });

  setMemberRole = (projectId: string, userId: string, role: ProjectMemberRole | null) =>
    lambdaClient.projectReview.setMemberRole.mutate({ projectId, userId, role });

  updateSite = (id: string, input: Partial<ProjectSiteInput>) =>
    lambdaClient.projectReview.updateSite.mutate({ id, ...input });
}

export const projectReviewService = new ProjectReviewService();
