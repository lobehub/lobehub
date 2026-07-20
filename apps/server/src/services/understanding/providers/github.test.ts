import { ConnectorDataError } from '@lobechat/connector-data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGitHubUnderstandingProvider } from './github';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubConnectorClient: createClient,
  toGitHubUserContextMarkdown: vi.fn(() => '# GitHub profile'),
}));

const source = {
  candidateId: 'connector:github',
  credential: { accessToken: 'secret' },
  credentialOrigin: 'connector' as const,
  credentialReference: 'connector:github',
  externalAccountId: 'github-user',
  grantedScopes: [],
  id: 'github',
  provider: 'github',
};

describe('createGitHubUnderstandingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps profile evidence when one optional enrichment remains retryable', async () => {
    createClient.mockReturnValue({
      getUserProfile: vi.fn(async () => ({ externalAccountId: 'github-user', login: 'neko' })),
      getUserProfileReadme: vi.fn(async () => undefined),
      listPinnedRepositories: vi.fn(async () => []),
      listRecentContributions: vi.fn(async () => {
        throw new ConnectorDataError({
          code: 'github_request_failed',
          operation: 'recentContributions',
          provider: 'github',
          retryable: true,
        });
      }),
      listRecentPullRequests: vi.fn(async () => []),
      listRecentRepositories: vi.fn(async () => []),
      listRepositoryContributors: vi.fn(async () => []),
      listUserOrganizations: vi.fn(async () => []),
    });

    await expect(
      createGitHubUnderstandingProvider().collect(source, { userId: 'user-1' }),
    ).resolves.toMatchObject({
      context: expect.stringContaining('# GitHub profile'),
      diagnostics: {
        errors: [
          expect.objectContaining({
            code: 'GITHUB_RECENT_CONTRIBUTIONS_FAILED',
            operation: 'recentContributions',
            retryable: true,
          }),
        ],
        evidenceCount: 1,
        failedCount: 1,
        succeededCount: 6,
      },
      sourceCount: 1,
    });
  });

  it('throws a retryable provider error when the required profile is unavailable', async () => {
    createClient.mockReturnValue({
      getUserProfile: vi.fn(async () => {
        throw new ConnectorDataError({
          code: 'github_request_failed',
          operation: 'profile',
          provider: 'github',
          retryable: true,
        });
      }),
      getUserProfileReadme: vi.fn(async () => undefined),
      listPinnedRepositories: vi.fn(async () => []),
      listRecentContributions: vi.fn(async () => []),
      listRecentPullRequests: vi.fn(async () => []),
      listRecentRepositories: vi.fn(async () => []),
      listUserOrganizations: vi.fn(async () => []),
    });

    await expect(
      createGitHubUnderstandingProvider().collect(source, { userId: 'user-1' }),
    ).rejects.toMatchObject({
      name: 'UnderstandingProviderAuthorizationError',
      retryable: true,
    });
  });
});
