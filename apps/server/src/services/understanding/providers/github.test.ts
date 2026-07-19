import { ConnectorDataError } from '@lobechat/connector-data';
import type { GitHubConnectorClient, GitHubUserContext } from '@lobechat/connector-data/github';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { sanitizeProviderDiagnostics } from '../sanitizer';
import { UnderstandingSourceIdentificationError } from '../types';
import { createGitHubUnderstandingProvider, githubUnderstandingRegistration } from './github';

const mocks = vi.hoisted(() => {
  const log = vi.fn();
  return {
    createClient: vi.fn(),
    createDebug: vi.fn(() => log),
    formatMarkdown: vi.fn(),
    log,
  };
});

vi.mock('debug', () => ({
  default: mocks.createDebug,
}));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubConnectorClient: mocks.createClient,
  toGitHubUserContextMarkdown: mocks.formatMarkdown,
}));

const collectionContext = { userId: 'user-1' };
const candidate = {
  candidateId: 'connector:connector-1',
  credentialOrigin: 'connector' as const,
  credentialReference: 'connector:connector-1',
  provider: 'github' as const,
};
const source = {
  ...candidate,
  credential: { accessToken: 'secret-token' },
  externalAccountId: '42',
  grantedScopes: ['read:user'],
  id: 'github:42',
};
const profile = {
  bio: 'Building tools.',
  externalAccountId: '42',
  login: 'neko',
  name: 'Neko',
};
const pinnedRepositories = [
  {
    description: 'AI application framework',
    nameWithOwner: 'lobehub/lobehub',
    stargazerCount: 70_000,
    topics: ['ai'],
  },
];
const recentRepositories = [
  {
    nameWithOwner: 'neko/shiori',
    pushedAt: '2026-07-08T00:00:00Z',
    topics: [],
  },
];
const recentPullRequests = [
  {
    number: 42,
    repository: 'acme/external',
    title: 'Improve external agent support',
  },
];
const recentContributions = [
  {
    count: 7,
    occurredAt: '2026-07-12T00:00:00Z',
    repository: 'lobehub/lobehub',
    title: '7 commits',
    type: 'commit' as const,
  },
];
const organizations = [{ login: 'lobehub', name: 'LobeHub' }];
const repositoryContributors = [{ contributionCount: 12, login: 'alice' }];

describe('createGitHubUnderstandingProvider', () => {
  let client: GitHubConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formatMarkdown.mockReturnValue('GITHUB_MARKDOWN_SENTINEL');
    client = {
      getUserProfile: vi.fn().mockResolvedValue(profile),
      getUserProfileReadme: vi.fn().mockResolvedValue('Profile readme'),
      listPinnedRepositories: vi.fn().mockResolvedValue(pinnedRepositories),
      listRecentContributions: vi.fn().mockResolvedValue(recentContributions),
      listRecentPullRequests: vi.fn().mockResolvedValue(recentPullRequests),
      listRecentRepositories: vi.fn().mockResolvedValue(recentRepositories),
      listRepositoryContributors: vi.fn().mockResolvedValue(repositoryContributors),
      listUserOrganizations: vi.fn().mockResolvedValue(organizations),
    };
    mocks.createClient.mockReturnValue(client);
  });

  it('exposes metadata and materializes the production registration', () => {
    expect(createGitHubUnderstandingProvider()).toMatchObject({
      id: 'github',
      originPriority: ['connector', 'auth_account', 'integration'],
      requiredScopes: [],
      usefulOptionalScopes: ['read:user', 'user:email', 'read:org', 'repo'],
    });

    const { provider } = githubUnderstandingRegistration.materialize({
      db: {} as LobeChatDatabase,
      userId: 'user-1',
    });
    expect(provider).toMatchObject({ id: 'github' });
  });

  it('discovers auth accounts and active connectors without resolving credentials', async () => {
    const loadCredential = vi.fn();
    const provider = createGitHubUnderstandingProvider({
      loadCredential,
      queryAuthAccounts: vi.fn().mockResolvedValue([
        { id: 'account-2', providerId: 'google' },
        { id: 'account-1', providerId: 'github' },
      ]),
      queryConnectors: vi.fn().mockResolvedValue([
        { id: 'connector-disabled', isEnabled: false, status: 'connected' },
        { id: 'connector-error', isEnabled: true, status: 'error' },
        { id: 'connector-1', isEnabled: true, status: 'connected' },
      ]),
    });

    await expect(provider.discoverSources(collectionContext)).resolves.toEqual([
      {
        candidateId: 'auth_account:account-1',
        credentialOrigin: 'auth_account',
        credentialReference: 'auth_account:account-1',
        provider: 'github',
      },
      candidate,
    ]);
    expect(loadCredential).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('loads and validates the credential before creating a client and uses the profile identity', async () => {
    const order: string[] = [];
    const loadCredential = vi.fn(async () => {
      order.push('credential');
      return {
        accessToken: 'secret-token',
        scope: 'repo read:user',
        scopes: ['read:org'],
      };
    });
    const getUserProfile = vi.fn(async () => {
      order.push('profile');
      return profile;
    });
    mocks.createClient.mockImplementation(() => {
      order.push('client');
      return { ...client, getUserProfile };
    });

    const identified = await createGitHubUnderstandingProvider({ loadCredential }).identifySource(
      candidate,
      collectionContext,
    );

    expect(order).toEqual(['credential', 'client', 'profile']);
    expect(mocks.createClient).toHaveBeenCalledWith({ accessToken: 'secret-token' });
    expect(identified).toEqual({
      credential: { accessToken: 'secret-token' },
      displayName: 'Neko (@neko)',
      externalAccountId: '42',
      grantedScopes: ['read:org', 'read:user', 'repo'],
    });
  });

  it('preserves transient identification retryability without leaking connector details', async () => {
    const upstream = new ConnectorDataError({
      code: 'github_request_failed',
      operation: 'getUserProfile',
      provider: 'github',
      retryable: true,
    });
    upstream.message = '503 upstream secret-token response';
    client.getUserProfile = vi.fn().mockRejectedValue(upstream);
    mocks.createClient.mockReturnValue(client);

    const error = await createGitHubUnderstandingProvider({
      loadCredential: async () => ({ accessToken: 'credential-token' }),
    })
      .identifySource(candidate, collectionContext)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(UnderstandingSourceIdentificationError);
    expect(error).toMatchObject({ retryable: true });
    expect(String(error)).not.toMatch(/503|secret-token|upstream/);
  });

  it('collects required semantic resources and formats the source brief', async () => {
    const result = await createGitHubUnderstandingProvider().collect(source, collectionContext);

    expect(client.getUserProfile).toHaveBeenCalledOnce();
    expect(client.listPinnedRepositories).toHaveBeenCalledOnce();
    expect(client.listRecentContributions).toHaveBeenCalledOnce();
    expect(client.listRecentPullRequests).toHaveBeenCalledOnce();
    expect(client.listRecentRepositories).toHaveBeenCalledOnce();
    expect(result).toEqual({
      diagnostics: {
        errors: [],
        evidenceCount: 5,
        failedCount: 0,
        succeededCount: 8,
      },
      sourceBrief: 'Provider: github\n\n# Source Brief\n\nGITHUB_MARKDOWN_SENTINEL',
      sourceCount: 5,
    });
  });

  it('starts optional enrichment concurrently and continues after a safe partial failure', async () => {
    const organizations = Promise.withResolvers<void>();
    const listUserOrganizations = vi.fn(async () => {
      await organizations.promise;
      return [{ login: 'lobehub' }];
    });
    const listRepositoryContributors = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'github_contributors_failed',
        operation: 'listRepositoryContributors',
        provider: 'github',
        retryable: false,
      }),
    );
    const getUserProfileReadme = vi.fn().mockResolvedValue('Profile readme');
    mocks.createClient.mockReturnValue({
      ...client,
      getUserProfileReadme,
      listRepositoryContributors,
      listUserOrganizations,
    });

    const collecting = createGitHubUnderstandingProvider().collect(source, collectionContext);
    await vi.waitFor(() => {
      expect(listUserOrganizations).toHaveBeenCalledOnce();
      expect(getUserProfileReadme).toHaveBeenCalledOnce();
      expect(listRepositoryContributors).toHaveBeenCalledOnce();
    });
    organizations.resolve();

    const result = await collecting;
    expect(result.diagnostics).toEqual({
      errors: [
        {
          code: 'GITHUB_CONTRIBUTORS_FAILED',
          message: 'GitHub contributor enrichment failed',
          operation: 'contributors:lobehub/lobehub',
          provider: 'github',
          retryable: false,
        },
      ],
      evidenceCount: 5,
      failedCount: 1,
      succeededCount: 7,
    });
    expect(result.sourceBrief).toContain('GITHUB_MARKDOWN_SENTINEL');
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret-token');
    expect(JSON.stringify(result.diagnostics)).not.toContain('github_contributors_failed');
  });

  it('runs independent supplemental operations concurrently and waits for pins before contributors', async () => {
    const pins = Promise.withResolvers<typeof pinnedRepositories>();
    const listPinnedRepositories = vi.fn(() => pins.promise);
    const listRepositoryContributors = vi.fn().mockResolvedValue(repositoryContributors);
    mocks.createClient.mockReturnValue({
      ...client,
      listPinnedRepositories,
      listRepositoryContributors,
    });

    const collecting = createGitHubUnderstandingProvider().collect(source, collectionContext);
    await vi.waitFor(() => {
      expect(client.listRecentContributions).toHaveBeenCalledOnce();
      expect(client.listRecentPullRequests).toHaveBeenCalledOnce();
      expect(client.listRecentRepositories).toHaveBeenCalledOnce();
      expect(client.listUserOrganizations).toHaveBeenCalledOnce();
      expect(client.getUserProfileReadme).toHaveBeenCalledOnce();
    });
    expect(listRepositoryContributors).not.toHaveBeenCalled();

    pins.resolve(pinnedRepositories);
    await expect(collecting).resolves.toMatchObject({
      diagnostics: { failedCount: 0, succeededCount: 8 },
    });
    expect(listRepositoryContributors).toHaveBeenCalledWith('lobehub/lobehub');
  });

  it('rejects promptly on profile failure without waiting for supplemental operations', async () => {
    const supplement = Promise.withResolvers<never>();
    const unresolved = vi.fn(() => supplement.promise);
    const listRepositoryContributors = vi.fn();
    mocks.createClient.mockReturnValue({
      ...client,
      getUserProfile: vi.fn().mockRejectedValue(new Error('profile unavailable')),
      getUserProfileReadme: unresolved,
      listPinnedRepositories: unresolved,
      listRecentContributions: unresolved,
      listRecentPullRequests: unresolved,
      listRecentRepositories: unresolved,
      listRepositoryContributors,
      listUserOrganizations: unresolved,
    });

    const outcome = await Promise.race([
      createGitHubUnderstandingProvider()
        .collect(source, collectionContext)
        .then(
          () => 'resolved',
          (error: unknown) => error,
        ),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);

    expect(outcome).toEqual(new Error('GitHub profile collection failed'));
    expect(unresolved).toHaveBeenCalledTimes(6);
    expect(listRepositoryContributors).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: 'GITHUB_PINNED_REPOSITORIES_FAILED',
      contextKey: 'pinnedRepositories',
      message: 'GitHub pinned repository enrichment failed',
      method: 'listPinnedRepositories',
      operation: 'pinnedRepositories',
      sanitizedOperation: 'pinned_repositories',
      succeededCount: 6,
    },
    {
      code: 'GITHUB_RECENT_CONTRIBUTIONS_FAILED',
      contextKey: 'recentContributions',
      message: 'GitHub recent contribution enrichment failed',
      method: 'listRecentContributions',
      operation: 'recentContributions',
      sanitizedOperation: 'recent_contributions',
      succeededCount: 7,
    },
    {
      code: 'GITHUB_RECENT_PULL_REQUESTS_FAILED',
      contextKey: 'recentPullRequests',
      message: 'GitHub recent pull request enrichment failed',
      method: 'listRecentPullRequests',
      operation: 'recentPullRequests',
      sanitizedOperation: 'recent_pull_requests',
      succeededCount: 7,
    },
    {
      code: 'GITHUB_RECENT_REPOSITORIES_FAILED',
      contextKey: 'recentRepositories',
      message: 'GitHub recent repository enrichment failed',
      method: 'listRecentRepositories',
      operation: 'recentRepositories',
      sanitizedOperation: 'recent_repositories',
      succeededCount: 7,
    },
    {
      code: 'GITHUB_ORGANIZATIONS_FAILED',
      contextKey: 'organizations',
      message: 'GitHub organization enrichment failed',
      method: 'listUserOrganizations',
      operation: 'organizations',
      sanitizedOperation: 'organizations',
      succeededCount: 7,
    },
    {
      code: 'GITHUB_PROFILE_README_FAILED',
      contextKey: 'profileReadme',
      message: 'GitHub profile README enrichment failed',
      method: 'getUserProfileReadme',
      operation: 'profileReadme',
      sanitizedOperation: 'profile_readme',
      succeededCount: 7,
    },
    {
      code: 'GITHUB_CONTRIBUTORS_FAILED',
      contextKey: 'repositoryContributors',
      message: 'GitHub contributor enrichment failed',
      method: 'listRepositoryContributors',
      operation: 'contributors:lobehub/lobehub',
      sanitizedOperation: 'contributors',
      succeededCount: 7,
    },
  ] as const)(
    'preserves partial context when $operation fails',
    async ({
      code,
      contextKey,
      message,
      method,
      operation,
      sanitizedOperation,
      succeededCount,
    }) => {
      vi.mocked(client[method]).mockRejectedValue(
        new ConnectorDataError({
          code: 'unsafe_connector_error',
          operation: 'unsafe-operation-secret',
          provider: 'github',
          retryable: false,
        }),
      );

      const result = await createGitHubUnderstandingProvider().collect(source, collectionContext);

      expect(result.diagnostics).toEqual({
        errors: [{ code, message, operation, provider: 'github', retryable: false }],
        evidenceCount: expect.any(Number),
        failedCount: 1,
        succeededCount,
      });
      expect(result.sourceBrief).toContain('GITHUB_MARKDOWN_SENTINEL');
      const formattedContext = mocks.formatMarkdown.mock.calls[0][0] as GitHubUserContext;
      const expectedContext: Record<string, unknown> = {
        organizations,
        pinnedRepositories,
        profile,
        profileReadme: 'Profile readme',
        recentContributions,
        recentPullRequests,
        recentRepositories,
        repositoryContributors: { 'lobehub/lobehub': repositoryContributors },
      };
      delete expectedContext[contextKey];
      if (method === 'listPinnedRepositories') delete expectedContext.repositoryContributors;
      expect(formattedContext).toEqual(expectedContext);
      expect(JSON.stringify(result.diagnostics)).not.toContain('unsafe_connector_error');
      expect(JSON.stringify(result.diagnostics)).not.toContain('unsafe-operation-secret');
      expect(sanitizeProviderDiagnostics('github', result.diagnostics).errors).toEqual([
        {
          code,
          message: `github ${sanitizedOperation} failed`,
          operation: sanitizedOperation,
          provider: 'github',
          retryable: false,
        },
      ]);
      if (method === 'listPinnedRepositories') {
        expect(client.listRepositoryContributors).not.toHaveBeenCalled();
      }
    },
  );

  it('reports a safe profile failure without leaking connector error details', async () => {
    const requiredGate = Promise.withResolvers<void>();
    const getUserProfile = vi.fn(async () => {
      await requiredGate.promise;
      throw new ConnectorDataError({
        code: 'github_request_failed',
        operation: 'unsafe-operation-secret',
        provider: 'github',
        retryable: false,
      });
    });
    const listPinnedRepositories = vi.fn(async () => {
      await requiredGate.promise;
      return pinnedRepositories;
    });
    const listRecentContributions = vi.fn(async () => {
      await requiredGate.promise;
      return recentContributions;
    });
    const listRecentPullRequests = vi.fn(async () => {
      await requiredGate.promise;
      return recentPullRequests;
    });
    const listRecentRepositories = vi.fn(async () => {
      await requiredGate.promise;
      return recentRepositories;
    });
    mocks.createClient.mockReturnValue({
      ...client,
      getUserProfile,
      listPinnedRepositories,
      listRecentContributions,
      listRecentPullRequests,
      listRecentRepositories,
    });

    const collecting = createGitHubUnderstandingProvider().collect(source, collectionContext);
    await vi.waitFor(() => {
      expect(getUserProfile).toHaveBeenCalledOnce();
      expect(listPinnedRepositories).toHaveBeenCalledOnce();
      expect(listRecentContributions).toHaveBeenCalledOnce();
      expect(listRecentPullRequests).toHaveBeenCalledOnce();
      expect(listRecentRepositories).toHaveBeenCalledOnce();
    });
    requiredGate.resolve();

    await expect(collecting).rejects.toThrow('GitHub profile collection failed');
    expect(mocks.log).toHaveBeenCalledWith('Required collection failed: %O', {
      code: 'github_request_failed',
      errorName: 'ConnectorDataError',
      operation: 'profile',
      retryable: false,
    });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('unsafe-operation-secret');
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('secret-token');
  });
});
