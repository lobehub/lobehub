import { ConnectorDataError } from '@lobechat/connector-data';
import type {
  GitHubContribution,
  GitHubPullRequest,
  GitHubRepository,
} from '@lobechat/connector-data/github';
import type { OnboardingTaskSource } from '@lobechat/types';

import type { GitHubTaskRecommendationProviderConfig } from '../config';
import { defaultTaskRecommendationConfig } from '../config';
import type { TaskRecommendationProvider } from '../types';

type GitHubSignal =
  | {
      kind: 'recent_contribution';
      relationship: 'author' | 'participant' | 'reviewer';
      sourceUrl?: string;
      value: GitHubContribution;
    }
  | {
      kind: 'recent_pull_request';
      relationship: 'author';
      sourceUrl?: string;
      value: GitHubPullRequest;
    }
  | {
      kind: 'repository_maintenance';
      relationship: 'owner';
      sourceUrl: string;
      value: GitHubRepository;
    };

/** Creates the independent GitHub task recommendation collector. */
export const createGitHubTaskRecommendationProvider = (
  config: GitHubTaskRecommendationProviderConfig = defaultTaskRecommendationConfig.providers.github,
): TaskRecommendationProvider => ({
  id: 'github',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getGitHubClient();
    const [repositoryResult, pullRequestResult, contributionResult] = await Promise.allSettled([
      client.listRecentRepositories(),
      client.listRecentPullRequests(),
      client.listRecentContributions(),
    ]);
    const operations = [
      { key: 'repositories', result: repositoryResult },
      { key: 'pull_requests', result: pullRequestResult },
      { key: 'contributions', result: contributionResult },
    ] as const;
    const errors = operations.flatMap(({ key, result }) =>
      result.status === 'rejected'
        ? [
            {
              code: 'GITHUB_TASK_SIGNAL_COLLECTION_FAILED',
              message: 'GitHub task signal collection failed',
              operation: key,
              provider: 'github',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );

    const now = Date.now();
    const staleBefore = now - config.staleAfterDays * 24 * 60 * 60 * 1000;
    const repositories = repositoryResult.status === 'fulfilled' ? repositoryResult.value : [];
    const pullRequests = pullRequestResult.status === 'fulfilled' ? pullRequestResult.value : [];
    const contributions = contributionResult.status === 'fulfilled' ? contributionResult.value : [];

    const signals: GitHubSignal[] = [
      ...repositories
        .filter(({ pushedAt }) => pushedAt && new Date(pushedAt).getTime() < staleBefore)
        .map((value) => ({
          kind: 'repository_maintenance' as const,
          relationship: 'owner' as const,
          sourceUrl: `https://github.com/${value.nameWithOwner}`,
          value,
        })),

      ...pullRequests.map((value) => ({
        kind: 'recent_pull_request' as const,
        relationship: 'author' as const,
        sourceUrl:
          value.repository && value.number
            ? `https://github.com/${value.repository}/pull/${value.number}`
            : value.repository
              ? `https://github.com/${value.repository}`
              : undefined,
        value,
      })),

      ...contributions.map((value) => ({
        kind: 'recent_contribution' as const,
        relationship:
          value.type === 'pull_request_review'
            ? ('reviewer' as const)
            : value.type === 'pull_request'
              ? ('author' as const)
              : ('participant' as const),
        sourceUrl: value.repository ? `https://github.com/${value.repository}` : undefined,
        value,
      })),
    ].slice(0, config.maxSignals);

    const context = JSON.stringify({ provider: 'github', signals }, null, 2).slice(
      0,
      config.maxContextLength,
    );

    return {
      context,
      diagnostics: {
        errors,
        evidenceCount: signals.length,
        failedCount: errors.length,
        succeededCount: operations.filter(({ result }) => result.status === 'fulfilled').length,
      },
      signalCount: signals.length,
      sources: signals.flatMap((signal): OnboardingTaskSource[] =>
        'sourceUrl' in signal && signal.sourceUrl
          ? [{ type: 'github', url: signal.sourceUrl }]
          : [],
      ),
    };
  },
});
