import type { TaskRecommendationProvider } from '../types';
import { createGitHubTaskRecommendationProvider } from './github';
import { createGmailTaskRecommendationProvider } from './gmail';

/** Independent connector providers used by the onboarding task workflow. */
export const taskRecommendationProviders = [
  createGitHubTaskRecommendationProvider(),
  createGmailTaskRecommendationProvider(),
] as const satisfies readonly TaskRecommendationProvider[];

/** Provider registry used for connector validation and workflow dispatch. */
export const taskRecommendationProviderMap = new Map<string, TaskRecommendationProvider>(
  taskRecommendationProviders.map((provider) => [provider.id, provider]),
);
