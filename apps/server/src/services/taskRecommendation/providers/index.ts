import type { TaskRecommendationProvider } from '../types';
import { createGitHubTaskRecommendationProvider } from './github';
import { createGmailTaskRecommendationProvider } from './gmail';
import { createNotionTaskRecommendationProvider } from './notion';
import { createTwitterTaskRecommendationProvider } from './twitter';

/** Independent connector providers used by the onboarding task workflow. */
export const taskRecommendationProviders = [
  createGitHubTaskRecommendationProvider(),
  createGmailTaskRecommendationProvider(),
  createNotionTaskRecommendationProvider(),
  createTwitterTaskRecommendationProvider(),
] as const satisfies readonly TaskRecommendationProvider[];

/** Provider registry used for connector validation and workflow dispatch. */
export const taskRecommendationProviderMap = new Map<string, TaskRecommendationProvider>(
  taskRecommendationProviders.map((provider) => [provider.id, provider]),
);
