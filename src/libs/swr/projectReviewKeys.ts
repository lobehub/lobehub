export const projectReviewKeys = {
  members: (projectId: string) => ['projectReview:members', projectId] as const,
  sites: (projectId: string) => ['projectReview:sites', projectId] as const,
};
