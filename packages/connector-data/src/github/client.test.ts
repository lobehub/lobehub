import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGitHubConnectorClient } from './client';
import { createGitHubOAuthConnectorClient } from './client-oauth';
import type { GitHubConnectorTransport } from './graphql/client';

const profileResult = {
  viewer: {
    bio: 'Building tools.',
    company: '@acme',
    location: 'Shanghai',
    login: 'octocat',
    name: 'Octocat',
    pronouns: 'they/them',
    websiteUrl: `https://example.com/\u0000${'x'.repeat(600)}`,
  },
};

const contributedRepositoryNodes = {
  external: {
    description: 'Widely used external project',
    forkCount: 500,
    nameWithOwner: 'acme/external',
    primaryLanguage: { name: 'Rust' },
    pushedAt: '2026-07-16T00:00:00Z',
    repositoryTopics: { nodes: [{ topic: { name: 'runtime' } }] },
    stargazerCount: 100_000,
  },
  primary: {
    description: 'AI framework',
    forkCount: 3000,
    nameWithOwner: 'acme/atlas',
    primaryLanguage: { name: 'TypeScript' },
    pushedAt: '2026-07-17T00:00:00Z',
    repositoryTopics: { nodes: [{ topic: { name: 'agent' } }] },
    stargazerCount: 70_000,
  },
};

const createTransport = () => {
  const calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  const listRepositoryContributors = vi.fn(async () => [
    { contributions: 9, login: '  octocat\u0000  ' },
    { contributions: 8, login: 'alice' },
    { contributions: 7, login: 'bob' },
    { contributions: 6, login: 'carol' },
    { contributions: 5, login: 'dave' },
    { contributions: 4, login: 'excluded' },
  ]);
  const listUserOrganizations = vi.fn(async () => [
    {
      description: 'Making AI accessible.',
      login: 'acme',
    },
  ]);
  const transport: GitHubConnectorTransport = {
    getAuthenticatedUser: async () => ({ id: 98_765, login: 'octocat' }),
    listRepositoryContributors,
    listUserOrganizations,
    request: async ({ operation, variables }) => {
      calls.push({ operation, variables });
      if (operation === 'ConnectorDataGitHubProfile') return profileResult;
      if (operation === 'ConnectorDataGitHubRepositories') {
        return {
          viewer: {
            pinnedItems: {
              nodes: [
                {
                  description: 'AI framework',
                  forkCount: 3,
                  issues: { totalCount: 4 },
                  nameWithOwner: 'acme/atlas',
                  primaryLanguage: { name: 'TypeScript' },
                  pullRequests: { totalCount: 5 },
                  repositoryTopics: { nodes: [{ topic: { name: 'ai' } }] },
                  stargazerCount: 70_000,
                },
              ],
            },
            pullRequests: {
              nodes: [
                {
                  number: 42,
                  repository: { nameWithOwner: 'acme/external' },
                  title: 'Improve agent support',
                  updatedAt: '2026-07-08T00:00:00Z',
                },
              ],
            },
            repositories: {
              nodes: [
                {
                  description: 'Recent work',
                  nameWithOwner: 'octocat/shiori',
                  primaryLanguage: null,
                  pushedAt: null,
                  stargazerCount: 80,
                },
              ],
            },
          },
        };
      }
      if (operation === 'ConnectorDataGitHubContributions') {
        return {
          viewer: {
            contributionsCollection: {
              commitContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ commitCount: 7, occurredAt: '2026-07-12T00:00:00Z' }],
                    totalCount: 47,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
              issueContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-06-01T00:00:00Z' }],
                    totalCount: 2,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-16T00:00:00Z' }],
                    totalCount: 1,
                  },
                  repository: { id: 'repo-external', nameWithOwner: 'acme/external' },
                },
              ],
              issueContributions: { nodes: [] },
              pullRequestContributions: {
                nodes: [
                  {
                    occurredAt: '2026-07-10T00:00:00Z',
                    pullRequest: {
                      repository: { nameWithOwner: 'acme/atlas' },
                      title: 'Add understanding pipeline',
                    },
                  },
                ],
              },
              pullRequestContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-10T00:00:00Z' }],
                    totalCount: 12,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
              pullRequestReviewContributions: { nodes: [] },
              pullRequestReviewContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-15T00:00:00Z' }],
                    totalCount: 8,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
            },
            recentContributionsCollection: {
              commitContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ commitCount: 7, occurredAt: '2026-07-12T00:00:00Z' }],
                    totalCount: 47,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
              issueContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-06-01T00:00:00Z' }],
                    totalCount: 2,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-16T00:00:00Z' }],
                    totalCount: 1,
                  },
                  repository: { id: 'repo-external', nameWithOwner: 'acme/external' },
                },
              ],
              pullRequestContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-10T00:00:00Z' }],
                    totalCount: 12,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
              pullRequestReviewContributionsByRepository: [
                {
                  contributions: {
                    nodes: [{ occurredAt: '2026-07-15T00:00:00Z' }],
                    totalCount: 8,
                  },
                  repository: { id: 'repo-primary', nameWithOwner: 'acme/atlas' },
                },
              ],
            },
            topRepositories: {
              nodes: [contributedRepositoryNodes.external, contributedRepositoryNodes.primary],
            },
          },
        };
      }
      if (operation === 'ConnectorDataGitHubContributedRepositoryMetadata') {
        const ids = variables.ids as string[];
        const repositories = {
          'repo-external': contributedRepositoryNodes.external,
          'repo-primary': contributedRepositoryNodes.primary,
        };
        return {
          nodes: ids.map((id) => repositories[id as keyof typeof repositories] ?? null),
        };
      }
      if (operation === 'ConnectorDataGitHubProfileReadme') {
        return { viewer: { repository: { object: { text: '# Octocat\nBuild useful tools.' } } } };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };

  return { calls, listRepositoryContributors, listUserOrganizations, transport };
};

describe('createGitHubConnectorClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a normalized authenticated user profile', async () => {
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await expect(client.getUserProfile()).resolves.toEqual({
      bio: 'Building tools.',
      company: '@acme',
      externalAccountId: '98765',
      location: 'Shanghai',
      login: 'octocat',
      name: 'Octocat',
      pronouns: 'they/them',
      websiteUrl: `https://example.com/${'x'.repeat(480)}...`,
    });
    expect(calls).toEqual([
      {
        operation: 'ConnectorDataGitHubProfile',
        variables: {},
      },
    ]);
  });

  it('lists normalized repository and contribution resources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-17T12:34:56.789Z');
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await expect(client.listPinnedRepositories()).resolves.toEqual([
      {
        description: 'AI framework',
        forkCount: 3,
        issueCount: 4,
        nameWithOwner: 'acme/atlas',
        primaryLanguage: 'TypeScript',
        pullRequestCount: 5,
        stargazerCount: 70_000,
        topics: ['ai'],
      },
    ]);
    await expect(client.listRecentRepositories()).resolves.toEqual([
      {
        description: 'Recent work',
        nameWithOwner: 'octocat/shiori',
        stargazerCount: 80,
        topics: [],
      },
    ]);
    await expect(client.listRecentPullRequests()).resolves.toEqual([
      {
        number: 42,
        repository: 'acme/external',
        title: 'Improve agent support',
        updatedAt: '2026-07-08T00:00:00Z',
      },
    ]);
    await expect(client.listRecentContributions()).resolves.toEqual([
      {
        count: 7,
        occurredAt: '2026-07-12T00:00:00Z',
        repository: 'acme/atlas',
        title: '7 commits',
        type: 'commit',
      },
      {
        count: 1,
        occurredAt: '2026-07-10T00:00:00Z',
        repository: 'acme/atlas',
        title: 'Add understanding pipeline',
        type: 'pull_request',
      },
    ]);
    await expect(client.listContributedRepositories()).resolves.toEqual([
      {
        contributions: { commits: 47, issues: 2, pullRequests: 12, reviews: 8, total: 69 },
        description: 'AI framework',
        forkCount: 3000,
        lastContributionAt: '2026-07-15T00:00:00Z',
        nameWithOwner: 'acme/atlas',
        primaryLanguage: 'TypeScript',
        pushedAt: '2026-07-17T00:00:00Z',
        stargazerCount: 70_000,
        topics: ['agent'],
      },
      {
        contributions: { commits: 0, issues: 1, pullRequests: 0, reviews: 0, total: 1 },
        description: 'Widely used external project',
        forkCount: 500,
        lastContributionAt: '2026-07-16T00:00:00Z',
        nameWithOwner: 'acme/external',
        primaryLanguage: 'Rust',
        pushedAt: '2026-07-16T00:00:00Z',
        stargazerCount: 100_000,
        topics: ['runtime'],
      },
    ]);
    await expect(client.listInfluentialRepositories()).resolves.toMatchObject([
      {
        contributions: { commits: 0, issues: 1, pullRequests: 0, reviews: 0, total: 1 },
        nameWithOwner: 'acme/external',
        stargazerCount: 100_000,
      },
      {
        contributions: { commits: 47, issues: 2, pullRequests: 12, reviews: 8, total: 69 },
        nameWithOwner: 'acme/atlas',
        stargazerCount: 70_000,
      },
    ]);
    await expect(client.listPinnedContributedRepositories()).resolves.toMatchObject([
      {
        contributions: { commits: 47, issues: 2, pullRequests: 12, reviews: 8, total: 69 },
        nameWithOwner: 'acme/atlas',
      },
    ]);
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubRepositories',
      variables: { first: 12, pullFirst: 4 },
    });
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubContributions',
      variables: {
        commitDayFirst: 3,
        contributionFirst: 10,
        from: '2025-07-17T12:34:56.789Z',
        influentialFirst: 12,
        recentFrom: '2026-04-18T12:34:56.789Z',
        repositoryFirst: 100,
      },
    });
    expect(
      calls.filter(({ operation }) => operation === 'ConnectorDataGitHubContributions'),
    ).toHaveLength(1);
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubContributedRepositoryMetadata',
      variables: { ids: ['repo-primary', 'repo-external'] },
    });
  });

  it('deduplicates concurrent repository requests', async () => {
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await Promise.all([client.listPinnedRepositories(), client.listRecentRepositories()]);

    expect(
      calls.filter(({ operation }) => operation === 'ConnectorDataGitHubRepositories'),
    ).toHaveLength(1);
  });

  it('applies the configured contribution window, limits, and local ranking', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-17T12:34:56.789Z');
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({
      contributionCollection: {
        candidateRepositories: 5,
        commitDaysPerRepository: 2,
        maxRecentContributions: 1,
        maxRepositories: 1,
        recentEventsPerType: 5,
        sort: 'contributions',
        windowDays: 30,
      },
      transport,
    });

    await expect(client.listContributedRepositories()).resolves.toMatchObject([
      { nameWithOwner: 'acme/atlas' },
    ]);
    await expect(client.listRecentContributions()).resolves.toHaveLength(1);
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubContributions',
      variables: {
        commitDayFirst: 2,
        contributionFirst: 5,
        from: '2026-06-17T12:34:56.789Z',
        influentialFirst: 12,
        recentFrom: '2026-04-18T12:34:56.789Z',
        repositoryFirst: 5,
      },
    });
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubContributedRepositoryMetadata',
      variables: { ids: ['repo-primary'] },
    });
  });

  it('clears a rejected profile request so a later call can recover', async () => {
    vi.useFakeTimers();
    let healthy = false;
    const request = vi.fn(async ({ operation }: { operation: string }) => {
      if (operation !== 'ConnectorDataGitHubProfile') throw new Error('Unexpected operation');
      if (!healthy) throw Object.assign(new Error('temporary outage'), { status: 503 });
      return profileResult;
    });
    const transport: GitHubConnectorTransport = {
      getAuthenticatedUser: async () => ({ id: 98_765, login: 'octocat' }),
      listRepositoryContributors: async () => [],
      listUserOrganizations: async () => [],
      request,
    };
    const client = createGitHubConnectorClient({ transport });
    const first = client.getUserProfile();
    const firstRejection = expect(first).rejects.toMatchObject({ retryable: true });

    await vi.runAllTimersAsync();
    await firstRejection;
    healthy = true;

    await expect(client.getUserProfile()).resolves.toMatchObject({ login: 'octocat' });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('normalizes and bounds repository contributors in the loader', async () => {
    const { listRepositoryContributors, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await expect(client.listRepositoryContributors('acme/atlas')).resolves.toEqual([
      { contributionCount: 9, login: 'octocat' },
      { contributionCount: 8, login: 'alice' },
      { contributionCount: 7, login: 'bob' },
      { contributionCount: 6, login: 'carol' },
      { contributionCount: 5, login: 'dave' },
    ]);
    expect(listRepositoryContributors).toHaveBeenCalledWith({
      owner: 'acme',
      perPage: 5,
      repository: 'atlas',
    });

    await expect(client.listRepositoryContributors('invalid')).resolves.toEqual([]);
    await expect(client.listRepositoryContributors('/missing-owner')).resolves.toEqual([]);
    expect(listRepositoryContributors).toHaveBeenCalledOnce();
  });

  it('does not expose repository input in contributor errors', async () => {
    const sensitiveRepository = 'token-sensitive-owner/private-repository';
    const transport: GitHubConnectorTransport = {
      getAuthenticatedUser: async () => ({ id: 98_765, login: 'octocat' }),
      listRepositoryContributors: vi.fn().mockRejectedValue({ status: 401 }),
      listUserOrganizations: async () => [],
      request: vi.fn(),
    };
    const client = createGitHubConnectorClient({ transport });

    const error = await client
      .listRepositoryContributors(sensitiveRepository)
      .catch((reason) => reason);

    expect(error).toMatchObject({
      message: 'github listRepositoryContributors failed',
      operation: 'listRepositoryContributors',
    });
    expect(JSON.stringify(error)).not.toContain(sensitiveRepository);
  });

  it('lists normalized organizations', async () => {
    const { listUserOrganizations, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await expect(client.listUserOrganizations()).resolves.toEqual([
      {
        description: 'Making AI accessible.',
        login: 'acme',
      },
    ]);
    expect(listUserOrganizations).toHaveBeenCalledWith({
      perPage: 20,
    });
  });

  it('loads the profile README using the authenticated login', async () => {
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ transport });

    await expect(client.getUserProfileReadme()).resolves.toBe('# Octocat\nBuild useful tools.');
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubProfileReadme',
      variables: { name: 'octocat' },
    });
  });

  it('creates an Octokit-backed client when only an access token is supplied', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = request.method === 'POST' ? await request.clone().json() : undefined;
      const data =
        typeof body === 'object' && body && 'query' in body
          ? { data: profileResult }
          : request.url.endsWith('/user/orgs?per_page=20')
            ? [{ description: 'Building useful tools.', login: 'acme' }]
            : { id: 1, login: 'octocat' };
      return new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const client = createGitHubOAuthConnectorClient({ accessToken: 'production-token' });

    await expect(client.getUserProfile()).resolves.toMatchObject({
      externalAccountId: '1',
      login: 'octocat',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([input, init]) => new Request(input, init).url)).toEqual([
      'https://api.github.com/graphql',
      'https://api.github.com/user',
    ]);

    await expect(client.listUserOrganizations()).resolves.toEqual([
      { description: 'Building useful tools.', login: 'acme' },
    ]);
    expect(fetch.mock.calls.map(([input, init]) => new Request(input, init).url)).toContain(
      'https://api.github.com/user/orgs?per_page=20',
    );
  });

  it('falls back to public organizations when the token lacks organization scope', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/user/orgs?per_page=20')) {
        return new Response(
          JSON.stringify({
            message: 'You need at least read:org scope or user scope to list your organizations.',
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 403,
          },
        );
      }
      if (request.url.endsWith('/user')) {
        return Response.json({ id: 1, login: 'octocat' });
      }
      if (request.url.endsWith('/users/octocat/orgs?per_page=20')) {
        return Response.json([{ description: 'Building useful tools.', login: 'acme' }]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const client = createGitHubOAuthConnectorClient({ accessToken: 'production-token' });

    await expect(client.listUserOrganizations()).resolves.toEqual([
      { description: 'Building useful tools.', login: 'acme' },
    ]);
    expect(fetch.mock.calls.map(([input, init]) => new Request(input, init).url)).toEqual([
      'https://api.github.com/user/orgs?per_page=20',
      'https://api.github.com/user',
      'https://api.github.com/users/octocat/orgs?per_page=20',
    ]);
  });
});
