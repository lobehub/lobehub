export const PROJECT_STATUSES = [
  'backlog',
  'active',
  'paused',
  'completed',
  'canceled',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_VISIBILITIES = ['private', 'public'] as const;

export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const PROJECT_COMPLETION_DECISIONS = ['accepted', 'rejected'] as const;

export type ProjectCompletionDecision = (typeof PROJECT_COMPLETION_DECISIONS)[number];
