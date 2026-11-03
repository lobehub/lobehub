import { TRPCClientError } from '@trpc/client';

import { useClientDataSWR } from '@/libs/swr';
import { projectReviewKeys } from '@/libs/swr/projectReviewKeys';
import { projectReviewService } from '@/services/projectReview';

export const useProjectSites = (projectId: string) =>
  useClientDataSWR(projectReviewKeys.sites(projectId), () =>
    projectReviewService.listSites(projectId),
  );

export const useProjectMembers = (projectId: string) =>
  useClientDataSWR(projectReviewKeys.members(projectId), () =>
    projectReviewService.listMembers(projectId),
  );

export const isForbidden = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'FORBIDDEN';
