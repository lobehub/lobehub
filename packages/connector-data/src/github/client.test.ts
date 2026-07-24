import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGitHubConnectorClient } from './client';
import type { GitHubConnectorTransport } from './graphql/client';

const profileResult = {
  viewer: {
    bio: 'Building tools.',
    company: '@lobehub',
    location: 'Shanghai',
    login: 'octocat',
    name: 'Octocat',
    pronouns: 'they/them',
    websiteUrl: `https://lobehub.com/\u0000${'x'.repeat(600)}`,
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
      login: 'lobehub',
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
                  nameWithOwner: 'lobehub/lobehub',
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
                  },
                  repository: { nameWithOwner: 'lobehub/lobehub' },
                },
              ],
              issueContributions: { nodes: [] },
              pullRequestContributions: {
                nodes: [
                  {
                    occurredAt: '2026-07-10T00:00:00Z',
                    pullRequest: {
                      repository: { nameWithOwner: 'lobehub/lobehub' },
                      title: 'Add understanding pipeline',
                    },
                  },
                ],
              },
              pullRequestReviewContributions: { nodes: [] },
            },
          },
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
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

    await expect(client.getUserProfile()).resolves.toEqual({
      bio: 'Building tools.',
      company: '@lobehub',
      externalAccountId: '98765',
      location: 'Shanghai',
      login: 'octocat',
      name: 'Octocat',
      pronouns: 'they/them',
      websiteUrl: `https://lobehub.com/${'x'.repeat(480)}...`,
    });
    expect(calls).toEqual([
      {
        operation: 'ConnectorDataGitHubProfile',
        variables: {},
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('test-token');
  });

  it('lists normalized repository and contribution resources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-17T12:34:56.789Z');
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

    await expect(client.listPinnedRepositories()).resolves.toEqual([
      {
        description: 'AI framework',
        forkCount: 3,
        issueCount: 4,
        nameWithOwner: 'lobehub/lobehub',
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
        repository: 'lobehub/lobehub',
        title: '7 commits',
        type: 'commit',
      },
      {
        count: 1,
        occurredAt: '2026-07-10T00:00:00Z',
        repository: 'lobehub/lobehub',
        title: 'Add understanding pipeline',
        type: 'pull_request',
      },
    ]);
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubRepositories',
      variables: { first: 12, pullFirst: 4 },
    });
    expect(calls).toContainEqual({
      operation: 'ConnectorDataGitHubContributions',
      variables: {
        contributionFirst: 10,
        from: '2026-01-18T12:34:56.789Z',
      },
    });
  });

  it('deduplicates concurrent repository requests', async () => {
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

    await Promise.all([client.listPinnedRepositories(), client.listRecentRepositories()]);

    expect(
      calls.filter(({ operation }) => operation === 'ConnectorDataGitHubRepositories'),
    ).toHaveLength(1);
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
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });
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
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

    await expect(client.listRepositoryContributors('lobehub/lobehub')).resolves.toEqual([
      { contributionCount: 9, login: 'octocat' },
      { contributionCount: 8, login: 'alice' },
      { contributionCount: 7, login: 'bob' },
      { contributionCount: 6, login: 'carol' },
      { contributionCount: 5, login: 'dave' },
    ]);
    expect(listRepositoryContributors).toHaveBeenCalledWith({
      owner: 'lobehub',
      perPage: 5,
      repository: 'lobehub',
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
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

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
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

    await expect(client.listUserOrganizations()).resolves.toEqual([
      {
        description: 'Making AI accessible.',
        login: 'lobehub',
      },
    ]);
    expect(listUserOrganizations).toHaveBeenCalledWith({
      perPage: 20,
    });
  });

  it('loads the profile README using the authenticated login', async () => {
    const { calls, transport } = createTransport();
    const client = createGitHubConnectorClient({ accessToken: 'test-token', transport });

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
            ? [{ description: 'Making AI accessible.', login: 'lobehub' }]
            : { id: 1, login: 'octocat' };
      return new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetch);
    const client = createGitHubConnectorClient({ accessToken: 'production-token' });

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
      { description: 'Making AI accessible.', login: 'lobehub' },
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
        return Response.json([{ description: 'Making AI accessible.', login: 'lobehub' }]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const client = createGitHubConnectorClient({ accessToken: 'production-token' });

    await expect(client.listUserOrganizations()).resolves.toEqual([
      { description: 'Making AI accessible.', login: 'lobehub' },
    ]);
    expect(fetch.mock.calls.map(([input, init]) => new Request(input, init).url)).toEqual([
      'https://api.github.com/user/orgs?per_page=20',
      'https://api.github.com/user',
      'https://api.github.com/users/octocat/orgs?per_page=20',
    ]);
  });
});
