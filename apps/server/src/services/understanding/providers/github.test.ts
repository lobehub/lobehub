import type { GitHubConnectorClient, GitHubUserProfile } from '@lobechat/connector-data/github';
import { describe, expect, it, vi } from 'vitest';

import { githubUnderstandingProvider } from './github';

describe('githubUnderstandingProvider', () => {
  it('starts supplemental collection without waiting for the profile', async () => {
    let resolveProfile: (profile: GitHubUserProfile) => void;
    const profile = new Promise<GitHubUserProfile>((resolve) => {
      resolveProfile = resolve;
    });
    const started = new Set<string>();
    const supplemental = <T>(name: string, result: T) =>
      vi.fn(async () => {
        started.add(name);
        return result;
      });
    const client = {
      getUserProfile: vi.fn(() => profile),
      getUserProfileReadme: supplemental('readme', undefined),
      listPinnedRepositories: supplemental('pinned', []),
      listRecentContributions: supplemental('contributions', []),
      listRecentPullRequests: supplemental('pullRequests', []),
      listRecentRepositories: supplemental('repositories', []),
      listRepositoryContributors: vi.fn(),
      listUserOrganizations: supplemental('organizations', []),
    } satisfies GitHubConnectorClient;

    const collecting = githubUnderstandingProvider.collect({
      connectorData: {
        getGitHubClient: vi.fn(async () => client),
      } as never,
      userId: 'user-id',
    });

    await vi.waitFor(() => expect(started.size).toBe(6));
    resolveProfile!({ externalAccountId: 'account-id', login: 'octocat' });

    await expect(collecting).resolves.toMatchObject({
      diagnostics: { failedCount: 0, succeededCount: 7 },
      sourceCount: 1,
    });
  });
});
