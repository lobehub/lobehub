import { ConnectorDataError } from '@lobechat/connector-data';
import type { GitHubUserContext } from '@lobechat/connector-data/github';
import { toGitHubUserContextMarkdown } from '@lobechat/connector-data/github';

import type { UnderstandingProvider } from '../types';

interface SupplementalOperation {
  code: string;
  key: Exclude<keyof GitHubUserContext, 'profile' | 'repositoryContributors'>;
  message: string;
  run: () => Promise<unknown>;
}

export const githubUnderstandingProvider: UnderstandingProvider = {
  id: 'github',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getGitHubClient();
    const profile = await client.getUserProfile();
    const operations: SupplementalOperation[] = [
      {
        code: 'GITHUB_PINNED_REPOSITORIES_FAILED',
        key: 'pinnedRepositories',
        message: 'GitHub pinned repository enrichment failed',
        run: () => client.listPinnedRepositories(),
      },
      {
        code: 'GITHUB_RECENT_CONTRIBUTIONS_FAILED',
        key: 'recentContributions',
        message: 'GitHub recent contribution enrichment failed',
        run: () => client.listRecentContributions(),
      },
      {
        code: 'GITHUB_RECENT_PULL_REQUESTS_FAILED',
        key: 'recentPullRequests',
        message: 'GitHub recent pull request enrichment failed',
        run: () => client.listRecentPullRequests(),
      },
      {
        code: 'GITHUB_RECENT_REPOSITORIES_FAILED',
        key: 'recentRepositories',
        message: 'GitHub recent repository enrichment failed',
        run: () => client.listRecentRepositories(),
      },
      {
        code: 'GITHUB_ORGANIZATIONS_FAILED',
        key: 'organizations',
        message: 'GitHub organization enrichment failed',
        run: () => client.listUserOrganizations(),
      },
      {
        code: 'GITHUB_PROFILE_README_FAILED',
        key: 'profileReadme',
        message: 'GitHub profile README enrichment failed',
        run: () => client.getUserProfileReadme(),
      },
    ];
    const settled = await Promise.allSettled(operations.map(({ run }) => run()));
    const context: GitHubUserContext = { profile };
    const errors = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') {
        Object.assign(context, { [operations[index].key]: result.value });
        return [];
      }
      return [
        {
          code: operations[index].code,
          message: operations[index].message,
          operation: operations[index].key,
          provider: 'github',
          retryable: result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
        },
      ];
    });
    const {
      organizations = [],
      pinnedRepositories = [],
      profileReadme,
      recentContributions = [],
      recentPullRequests = [],
      recentRepositories = [],
    } = context;
    const hasPrimaryProfileEvidence = Boolean(
      profileReadme || pinnedRepositories.length > 0 || recentContributions.length > 0,
    );
    const sourceCount =
      1 +
      organizations.length +
      (profileReadme ? 1 : 0) +
      pinnedRepositories.length +
      recentContributions.length +
      (hasPrimaryProfileEvidence ? 0 : recentRepositories.length + recentPullRequests.length);

    return {
      context: ['Provider: github', '# Source Brief', toGitHubUserContextMarkdown(context)].join(
        '\n\n',
      ),
      diagnostics: {
        errors,
        evidenceCount: sourceCount,
        failedCount: errors.length,
        succeededCount: 1 + settled.filter(({ status }) => status === 'fulfilled').length,
      },
      sourceCount,
    };
  },
};
