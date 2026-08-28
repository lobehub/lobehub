import { withConnectorRetry } from '../retry';
import type { GitHubConnectorTransport, GitHubGraphQLClient } from './graphql/client';
import {
  CONTRIBUTED_REPOSITORY_METADATA_QUERY,
  ContributedRepositoryMetadataQueryResponseSchema,
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
  GitHubContributedRepository,
  GitHubContributedRepositorySort,
  GitHubContribution,
  GitHubContributionCollectionOptions,
  GitHubOrganization,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositoryContributor,
  GitHubUserProfile,
} from './types';

const MAX_CONTRIBUTORS = 5;
const MAX_PROFILE_FIELD_LENGTH = 500;
const MAX_PROFILE_README_SOURCE_CHARS = 40_000;

interface GitHubContributionOverview {
  candidates: GitHubContributionCandidate[];
  contributions: GitHubContribution[];
  influentialRepositories: GitHubContributedRepository[];
  repositories: GitHubContributedRepository[];
}

interface GitHubContributionCandidate extends GitHubContributedRepository {
  nodeId: string;
}

const defaultGitHubContributionCollectionOptions = {
  candidateRepositories: 100,
  commitDaysPerRepository: 3,
  maxInfluentialRepositories: 12,
  maxRecentContributions: 40,
  maxRepositories: 24,
  recentEventsPerType: 10,
  recentWindowDays: 90,
  sort: 'contributions',
  windowDays: 365,
} as const satisfies Required<GitHubContributionCollectionOptions>;

// GitHub GraphQL rejects connection page sizes above 100.
const GITHUB_GRAPHQL_MAX_PAGE_SIZE = 100;

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
  const authenticated = await withConnectorRetry(() => transport.getAuthenticatedUser());
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
  const organizations = await withConnectorRetry(() =>
    transport.listUserOrganizations({ perPage: 20 }),
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

const normalizeCollectionOptions = (
  options: GitHubContributionCollectionOptions,
): Required<GitHubContributionCollectionOptions> => {
  const merged = { ...defaultGitHubContributionCollectionOptions, ...options };
  const boundedInteger = (value: number, maximum = GITHUB_GRAPHQL_MAX_PAGE_SIZE) =>
    Math.min(maximum, Math.max(1, Math.floor(value)));

  return {
    ...merged,
    candidateRepositories: boundedInteger(merged.candidateRepositories),
    commitDaysPerRepository: boundedInteger(merged.commitDaysPerRepository),
    maxInfluentialRepositories: boundedInteger(merged.maxInfluentialRepositories),
    maxRecentContributions: boundedInteger(merged.maxRecentContributions, 1000),
    maxRepositories: boundedInteger(merged.maxRepositories),
    recentEventsPerType: boundedInteger(merged.recentEventsPerType),
    recentWindowDays: boundedInteger(merged.recentWindowDays, 3650),
    windowDays: boundedInteger(merged.windowDays, 3650),
  };
};

const latestTimestamp = (left: string | undefined, right: string | undefined) => {
  if (!left) return right;
  if (!right) return left;
  return left.localeCompare(right) >= 0 ? left : right;
};

const compareContributedRepositories = (
  sort: GitHubContributedRepositorySort,
  left: GitHubContributedRepository,
  right: GitHubContributedRepository,
) => {
  const byStars = (right.stargazerCount ?? 0) - (left.stargazerCount ?? 0);
  const byContributions = right.contributions.total - left.contributions.total;
  const byRecent = String(right.lastContributionAt).localeCompare(String(left.lastContributionAt));

  if (sort === 'contributions' && byContributions !== 0) return byContributions;
  if (sort === 'recent' && byRecent !== 0) return byRecent;
  if (sort === 'stars' && byStars !== 0) return byStars;
  if (byContributions !== 0) return byContributions;
  if (byRecent !== 0) return byRecent;
  if (byStars !== 0) return byStars;
  return left.nameWithOwner.localeCompare(right.nameWithOwner);
};

/**
 * Loads a time-bounded GitHub activity overview and repository catalog.
 *
 * Use when:
 * - Building user understanding from recent GitHub participation
 * - Rendering repository prominence separately from chronological activity
 *
 * Expects:
 * - GitHub contribution groups expose exact per-kind `totalCount` values for the time window
 * - Repository candidates are ranked before metadata enrichment bounds the second request
 *
 * Returns:
 * - Recent contribution samples plus a frequency-ranked, metadata-enriched repository shortlist
 */
export const loadContributionOverview = async (
  client: GitHubGraphQLClient,
  options: GitHubContributionCollectionOptions = {},
): Promise<GitHubContributionOverview> => {
  const config = normalizeCollectionOptions(options);
  const now = Date.now();
  const response = await client.execute({
    operation: 'ConnectorDataGitHubContributions',
    query: CONTRIBUTIONS_QUERY,
    schema: ContributionsQueryResponseSchema,
    variables: {
      commitDayFirst: config.commitDaysPerRepository,
      contributionFirst: config.recentEventsPerType,
      from: new Date(now - config.windowDays * 24 * 60 * 60 * 1000).toISOString(),
      influentialFirst: config.maxInfluentialRepositories,
      recentFrom: new Date(now - config.recentWindowDays * 24 * 60 * 60 * 1000).toISOString(),
      repositoryFirst: config.candidateRepositories,
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

  const recentContributions = contributions
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .slice(0, config.maxRecentContributions);
  const annualRepositories = new Map<string, GitHubContributionCandidate>();
  const recentRepositories = new Map<string, GitHubContributionCandidate>();
  const ensureRepositoryReference = (
    repositories: Map<string, GitHubContributionCandidate>,
    repository: { id: string; nameWithOwner: string },
  ) => {
    const existing = repositories.get(repository.nameWithOwner);
    if (existing) return existing;

    const created: GitHubContributionCandidate = {
      contributions: { commits: 0, issues: 0, pullRequests: 0, reviews: 0, total: 0 },
      nameWithOwner: repository.nameWithOwner,
      nodeId: repository.id,
      topics: [],
    };
    repositories.set(created.nameWithOwner, created);
    return created;
  };

  const mergeGroup = (
    repositories: Map<string, GitHubContributionCandidate>,
    group: {
      contributions: { nodes: Array<{ occurredAt: string } | null>; totalCount: number };
      repository: { id: string; nameWithOwner: string };
    },
    kind: keyof Omit<GitHubContributedRepository['contributions'], 'total'>,
  ) => {
    const repository = ensureRepositoryReference(repositories, group.repository);
    repository.contributions[kind] = group.contributions.totalCount;
    repository.contributions.total =
      repository.contributions.commits +
      repository.contributions.issues +
      repository.contributions.pullRequests +
      repository.contributions.reviews;
    repository.lastContributionAt = latestTimestamp(
      repository.lastContributionAt,
      group.contributions.nodes[0]?.occurredAt,
    );
  };

  const mergeRepositoryGroups = (
    repositories: Map<string, GitHubContributionCandidate>,
    groups: typeof response.viewer.recentContributionsCollection,
  ) => {
    for (const group of groups.commitContributionsByRepository) {
      if (group) mergeGroup(repositories, group, 'commits');
    }
    for (const group of groups.issueContributionsByRepository) {
      if (group) mergeGroup(repositories, group, 'issues');
    }
    for (const group of groups.pullRequestContributionsByRepository) {
      if (group) mergeGroup(repositories, group, 'pullRequests');
    }
    for (const group of groups.pullRequestReviewContributionsByRepository) {
      if (group) mergeGroup(repositories, group, 'reviews');
    }
  };

  mergeRepositoryGroups(annualRepositories, collection);
  mergeRepositoryGroups(recentRepositories, response.viewer.recentContributionsCollection);

  const rankedRepositories = [...recentRepositories.values()]
    .sort((left, right) => compareContributedRepositories('contributions', left, right))
    .slice(0, config.maxRepositories);
  const metadataResponse =
    rankedRepositories.length > 0
      ? await client.execute({
          operation: 'ConnectorDataGitHubContributedRepositoryMetadata',
          query: CONTRIBUTED_REPOSITORY_METADATA_QUERY,
          schema: ContributedRepositoryMetadataQueryResponseSchema,
          variables: { ids: rankedRepositories.map(({ nodeId }) => nodeId) },
        })
      : { nodes: [] };
  const metadataByRepository = new Map(
    metadataResponse.nodes.flatMap((repository) => {
      if (!repository) return [];
      const normalized = normalizeRepository(repository);
      return [[normalized.nameWithOwner, normalized] as const];
    }),
  );
  const attachContributionSummary = (
    repository: Parameters<typeof normalizeRepository>[0],
  ): GitHubContributedRepository => {
    const normalized = normalizeRepository(repository);
    const candidate = annualRepositories.get(normalized.nameWithOwner);
    return {
      ...normalized,
      contributions: candidate?.contributions ?? {
        commits: 0,
        issues: 0,
        pullRequests: 0,
        reviews: 0,
        total: 0,
      },
      lastContributionAt: candidate?.lastContributionAt,
    };
  };

  return {
    candidates: [...annualRepositories.values()],
    contributions: recentContributions,
    influentialRepositories: response.viewer.topRepositories.nodes
      .flatMap((repository) => (repository ? [attachContributionSummary(repository)] : []))
      .sort((left, right) => compareContributedRepositories('stars', left, right)),
    repositories: rankedRepositories
      .map(({ nodeId: _, ...repository }) => ({
        ...repository,
        ...metadataByRepository.get(repository.nameWithOwner),
      }))
      .sort((left, right) => compareContributedRepositories(config.sort, left, right)),
  };
};

export const loadRepositoryContributors = async (
  transport: GitHubConnectorTransport,
  repository: string,
): Promise<GitHubRepositoryContributor[]> => {
  const [owner, repositoryName, ...rest] = repository.split('/');
  if (!owner || !repositoryName || rest.length > 0) return [];

  const contributors = await withConnectorRetry(() =>
    transport.listRepositoryContributors({
      owner,
      perPage: MAX_CONTRIBUTORS,
      repository: repositoryName,
    }),
  );

  return contributors.slice(0, MAX_CONTRIBUTORS).map(({ contributions, login }) => ({
    contributionCount: contributions,
    login: clean(login),
  }));
};
