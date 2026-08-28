import { ConnectorDataError } from '@lobechat/connector-data';
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
      listContributedRepositories: supplemental('contributedRepositories', []),
      listInfluentialRepositories: supplemental('influentialRepositories', []),
      listPinnedRepositories: supplemental('pinned', []),
      listPinnedContributedRepositories: supplemental('pinnedContributions', []),
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

    await vi.waitFor(() => expect(started.size).toBe(9));
    resolveProfile!({ externalAccountId: 'account-id', login: 'octocat' });

    await expect(collecting).resolves.toMatchObject({
      diagnostics: { failedCount: 0, succeededCount: 10 },
      sourceCount: 1,
    });
  });

  /** @example expect(result.diagnostics.errors[0].message).toContain('viewer.repository'); */
  it('preserves a profile README failure message in provider diagnostics', async () => {
    // ROOT CAUSE:
    //
    // Promise.allSettled exposed the original profile README rejection, but the provider replaced
    // it with a generic enrichment message before persistence and observability could inspect it.
    //
    // Before: "GraphQL FORBIDDEN at viewer.repository" became
    // "GitHub profile README enrichment failed".
    //
    // We fixed this by retaining the rejected ConnectorDataError message in the diagnostic.
    const upstreamMessage = 'GraphQL FORBIDDEN at viewer.repository(name: profile)';
    const empty = vi.fn(async () => []);
    const client = {
      getUserProfile: vi.fn(async () => ({ externalAccountId: 'account-id', login: 'octocat' })),
      getUserProfileReadme: vi.fn(async () => {
        throw new ConnectorDataError({
          code: 'github_request_failed',
          message: upstreamMessage,
          operation: 'ConnectorDataGitHubProfileReadme',
          provider: 'github',
          retryable: false,
        });
      }),
      listContributedRepositories: empty,
      listInfluentialRepositories: empty,
      listPinnedRepositories: empty,
      listPinnedContributedRepositories: empty,
      listRecentContributions: empty,
      listRecentPullRequests: empty,
      listRecentRepositories: empty,
      listRepositoryContributors: empty,
      listUserOrganizations: empty,
    } satisfies GitHubConnectorClient;

    const result = await githubUnderstandingProvider.collect({
      connectorData: {
        getGitHubClient: vi.fn(async () => client),
      } as never,
      userId: 'user-id',
    });

    /** @example expect(result.diagnostics.errors[0]).toMatchObject({ message: upstreamMessage }); */
    expect(result.diagnostics.errors[0]).toMatchObject({
      code: 'GITHUB_PROFILE_README_FAILED',
      message: upstreamMessage,
      operation: 'profileReadme',
      provider: 'github',
      retryable: false,
    });
  });
});
