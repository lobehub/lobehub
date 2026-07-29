import { withConnectorRetry } from '../retry';
import type { GitHubConnectorTransport, GitHubGraphQLClient } from './graphql/client';
import {
  CONTRIBUTIONS_QUERY,
  ContributionsQueryResponseSchema,
} from './graphql/queries/contributions';
import { PROFILE_QUERY, ProfileQueryResponseSchema } from './graphql/queries/profile';
import {
  PROFILE_README_QUERY,
  ProfileReadmeQueryResponseSchema,
} from './graphql/queries/profileReadme';
import {
  REPOSITORIES_QUERY,
  RepositoriesQueryResponseSchema,
} from './graphql/queries/repositories';
import type {
  GitHubContribution,
  GitHubOrganization,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositoryContributor,
  GitHubUserProfile,
} from './types';

const MAX_CONTRIBUTIONS = 40;
const MAX_CONTRIBUTORS = 5;
const MAX_PROFILE_FIELD_LENGTH = 500;
const MAX_PROFILE_README_SOURCE_CHARS = 40_000;
const RECENT_CONTRIBUTION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

const clean = (value: string | null | undefined) => {
  const normalized = value?.replaceAll('\u0000', '').trim();
  return normalized || undefined;
};

const cleanBounded = (value: string | null | undefined, limit: number) => {
  const normalized = clean(value);
  if (!normalized || normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}...`;
};

const normalizeRepository = (repository: {
  description: string | null;
  forkCount?: number;
  issues?: { totalCount: number };
  nameWithOwner: string;
  primaryLanguage: { name: string } | null;
  pullRequests?: { totalCount: number };
  pushedAt?: string | null;
  repositoryTopics?: { nodes: Array<{ topic: { name: string } } | null> };
  stargazerCount: number;
}): GitHubRepository => ({
  description: clean(repository.description),
  forkCount: repository.forkCount,
  issueCount: repository.issues?.totalCount,
  nameWithOwner: repository.nameWithOwner,
  primaryLanguage: clean(repository.primaryLanguage?.name),
  pullRequestCount: repository.pullRequests?.totalCount,
  pushedAt: clean(repository.pushedAt),
  stargazerCount: repository.stargazerCount,
  topics:
    repository.repositoryTopics?.nodes
      .flatMap((node) => clean(node?.topic.name) ?? [])
      .slice(0, 10) ?? [],
});

const normalizePullRequest = (pullRequest: {
  number: number;
  repository: { nameWithOwner: string };
  title: string;
  updatedAt: string;
}): GitHubPullRequest => ({
  number: pullRequest.number,
  repository: clean(pullRequest.repository.nameWithOwner),
  title: clean(pullRequest.title),
  updatedAt: pullRequest.updatedAt,
});

export const loadProfileBundle = async (client: GitHubGraphQLClient) =>
  client.execute({
    operation: 'ConnectorDataGitHubProfile',
    query: PROFILE_QUERY,
    schema: ProfileQueryResponseSchema,
    variables: {},
  });

export const loadUserProfile = async (
  profileBundle: Awaited<ReturnType<typeof loadProfileBundle>>,
  transport: GitHubConnectorTransport,
): Promise<GitHubUserProfile> => {
  const authenticated = await withConnectorRetry(() => transport.getAuthenticatedUser(), {
    code: 'github_request_failed',
    operation: 'getAuthenticatedUser',
    provider: 'github',
  });
  const { viewer } = profileBundle;

  return {
    bio: clean(viewer.bio),
    company: clean(viewer.company),
    externalAccountId: String(authenticated.id),
    location: clean(viewer.location),
    login: viewer.login,
    name: clean(viewer.name),
    pronouns: clean(viewer.pronouns),
    websiteUrl: cleanBounded(viewer.websiteUrl, MAX_PROFILE_FIELD_LENGTH),
  };
};

export const loadOrganizations = async (
  transport: GitHubConnectorTransport,
): Promise<GitHubOrganization[]> => {
  const organizations = await withConnectorRetry(
    () => transport.listUserOrganizations({ perPage: 20 }),
    {
      code: 'github_request_failed',
      operation: 'listUserOrganizations',
      provider: 'github',
    },
  );

  return organizations.flatMap((organization) =>
    organization.login
      ? [
          {
            description: clean(organization.description),
            login: clean(organization.login),
          },
        ]
      : [],
  );
};

export const loadProfileReadme = async (
  client: GitHubGraphQLClient,
  login: string,
): Promise<string | undefined> => {
  const response = await client.execute({
    operation: 'ConnectorDataGitHubProfileReadme',
    query: PROFILE_README_QUERY,
    schema: ProfileReadmeQueryResponseSchema,
    variables: { name: login },
  });
  const text = clean(response.viewer.repository?.object?.text);

  return text?.slice(0, MAX_PROFILE_README_SOURCE_CHARS);
};

export const loadRepositories = async (client: GitHubGraphQLClient) => {
  const response = await client.execute({
    operation: 'ConnectorDataGitHubRepositories',
    query: REPOSITORIES_QUERY,
    schema: RepositoriesQueryResponseSchema,
    variables: { first: 12, pullFirst: 4 },
  });

  return {
    pinned: response.viewer.pinnedItems.nodes.flatMap((item) =>
      item ? [normalizeRepository(item)] : [],
    ),
    pulls: response.viewer.pullRequests.nodes.flatMap((item) =>
      item ? [normalizePullRequest(item)] : [],
    ),
    recent: response.viewer.repositories.nodes.flatMap((item) =>
      item ? [normalizeRepository(item)] : [],
    ),
  };
};

export const loadContributions = async (
  client: GitHubGraphQLClient,
): Promise<GitHubContribution[]> => {
  const response = await client.execute({
    operation: 'ConnectorDataGitHubContributions',
    query: CONTRIBUTIONS_QUERY,
    schema: ContributionsQueryResponseSchema,
    variables: {
      contributionFirst: 10,
      from: new Date(Date.now() - RECENT_CONTRIBUTION_WINDOW_MS).toISOString(),
    },
  });
  const collection = response.viewer.contributionsCollection;
  const contributions: GitHubContribution[] = [];

  for (const item of collection.pullRequestContributions.nodes) {
    if (!item) continue;
    contributions.push({
      count: 1,
      occurredAt: item.occurredAt,
      repository: item.pullRequest.repository.nameWithOwner,
      title: item.pullRequest.title,
      type: 'pull_request',
    });
  }
  for (const item of collection.issueContributions.nodes) {
    if (!item) continue;
    contributions.push({
      count: 1,
      occurredAt: item.occurredAt,
      repository: item.issue.repository.nameWithOwner,
      title: item.issue.title,
      type: 'issue',
    });
  }
  for (const item of collection.pullRequestReviewContributions.nodes) {
    if (!item) continue;
    const pullRequest = item.pullRequestReview.pullRequest;
    contributions.push({
      count: 1,
      occurredAt: item.occurredAt,
      repository: pullRequest.repository.nameWithOwner,
      title: `Reviewed: ${pullRequest.title}`,
      type: 'pull_request_review',
    });
  }
  for (const group of collection.commitContributionsByRepository) {
    if (!group) continue;
    for (const item of group.contributions.nodes) {
      if (!item?.commitCount) continue;
      contributions.push({
        count: item.commitCount,
        occurredAt: item.occurredAt,
        repository: group.repository.nameWithOwner,
        title: `${item.commitCount} commit${item.commitCount === 1 ? '' : 's'}`,
        type: 'commit',
      });
    }
  }

  return contributions
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .slice(0, MAX_CONTRIBUTIONS);
};

export const loadRepositoryContributors = async (
  transport: GitHubConnectorTransport,
  repository: string,
): Promise<GitHubRepositoryContributor[]> => {
  const [owner, repositoryName, ...rest] = repository.split('/');
  if (!owner || !repositoryName || rest.length > 0) return [];

  const contributors = await withConnectorRetry(
    () =>
      transport.listRepositoryContributors({
        owner,
        perPage: MAX_CONTRIBUTORS,
        repository: repositoryName,
      }),
    {
      code: 'github_request_failed',
      operation: 'listRepositoryContributors',
      provider: 'github',
    },
  );

  return contributors.slice(0, MAX_CONTRIBUTORS).map(({ contributions, login }) => ({
    contributionCount: contributions,
    login: clean(login),
  }));
};
