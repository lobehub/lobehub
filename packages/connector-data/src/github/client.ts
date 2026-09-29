import { createRecoverableMemo } from '../memo';
import type { GitHubConnectorTransport } from './graphql/client';
import { createGitHubGraphQLClient } from './graphql/client';
import {
  loadContributionOverview,
  loadOrganizations,
  loadProfileBundle,
  loadProfileReadme,
  loadRepositories,
  loadRepositoryContributors,
  loadUserProfile,
} from './loaders';
import type {
  GitHubContributedRepository,
  GitHubContribution,
  GitHubContributionCollectionOptions,
  GitHubOrganization,
  GitHubOwnerRepository,
  GitHubPullRequest,
  GitHubRepository,
  GitHubRepositoryContributor,
  GitHubUserProfile,
} from './types';

const BRANCH_PAGE_SIZE = 100;

/**
 * The most branches {@link GitHubConnectorClient.listRepositoryBranches}
 * returns. A list of exactly this length may be partial.
 */
export const MAX_REPOSITORY_BRANCHES = 1000;

export interface GitHubConnectorClient {
  getUserProfile: () => Promise<GitHubUserProfile>;
  getUserProfileReadme: () => Promise<string | undefined>;
  /** Every repository this account can reach, newest activity first. */
  listAccessibleRepositories: () => Promise<GitHubOwnerRepository[]>;
  /** Lists repositories associated with the user during the configured contribution window. */
  listContributedRepositories: () => Promise<GitHubContributedRepository[]>;
  /** Lists high-star repositories with contribution evidence in the configured window. */
  listInfluentialRepositories: () => Promise<GitHubContributedRepository[]>;
  /** Lists pinned repositories that also have contribution evidence in the configured window. */
  listPinnedContributedRepositories: () => Promise<GitHubContributedRepository[]>;
  listPinnedRepositories: () => Promise<GitHubRepository[]>;
  listRecentContributions: () => Promise<GitHubContribution[]>;
  listRecentPullRequests: () => Promise<GitHubPullRequest[]>;
  listRecentRepositories: () => Promise<GitHubRepository[]>;
  /** Branch names of one repository, in the order GitHub lists them. */
  listRepositoryBranches: (owner: string, repository: string) => Promise<string[]>;
  listRepositoryContributors: (repository: string) => Promise<GitHubRepositoryContributor[]>;
  listUserOrganizations: () => Promise<GitHubOrganization[]>;
}

export interface CreateGitHubConnectorClientOptions {
  /** Collection and ranking policy for recent GitHub contribution evidence. */
  contributionCollection?: GitHubContributionCollectionOptions;
  /** Authentication and protocol adapter used by the shared GitHub data loaders. */
  transport: GitHubConnectorTransport;
}

/**
 * Creates a GitHub connector from a required transport adapter.
 *
 * Use when:
 * - A provider adapter supplies the shared REST and GraphQL transport contract
 *
 * Expects:
 * - A fully initialized transport; authentication is handled by the provider adapter
 *
 * Returns:
 * - The stable domain-level GitHub connector interface
 */
export function createGitHubConnectorClient({
  contributionCollection,
  transport,
}: CreateGitHubConnectorClientOptions): GitHubConnectorClient {
  const graphqlClient = createGitHubGraphQLClient(transport);
  const getProfileBundle = createRecoverableMemo(() => loadProfileBundle(graphqlClient));
  const getRepositories = createRecoverableMemo(() => loadRepositories(graphqlClient));
  const getContributionOverview = createRecoverableMemo(() =>
    loadContributionOverview(graphqlClient, contributionCollection),
  );

  return {
    getUserProfile: async () => loadUserProfile(await getProfileBundle(), transport),
    getUserProfileReadme: async () => {
      const { viewer } = await getProfileBundle();
      return loadProfileReadme(graphqlClient, viewer.login);
    },
    listContributedRepositories: async () => (await getContributionOverview()).repositories,
    listInfluentialRepositories: async () =>
      (await getContributionOverview()).influentialRepositories,
    listPinnedContributedRepositories: async () => {
      const [{ candidates }, { pinned }] = await Promise.all([
        getContributionOverview(),
        getRepositories(),
      ]);
      const contributionsByRepository = new Map(
        candidates.map((repository) => [repository.nameWithOwner, repository] as const),
      );

      return pinned.flatMap((repository) => {
        const contribution = contributionsByRepository.get(repository.nameWithOwner);
        if (!contribution) return [];
        return [
          {
            ...repository,
            contributions: contribution.contributions,
            lastContributionAt: contribution.lastContributionAt,
          },
        ];
      });
    },
    listPinnedRepositories: async () => (await getRepositories()).pinned,
    listRecentContributions: async () => (await getContributionOverview()).contributions,
    listRecentPullRequests: async () => (await getRepositories()).pulls,
    listRecentRepositories: async () => (await getRepositories()).recent,
    listRepositoryBranches: async (owner, repository) => {
      // GitHub pages at 100. Walked to a ceiling rather than to the end: a
      // repository with thousands of branches would otherwise be thousands of
      // requests behind one picker. A caller that gets exactly the ceiling back
      // should treat the list as partial.
      const names: string[] = [];
      for (let page = 1; page <= MAX_REPOSITORY_BRANCHES / BRANCH_PAGE_SIZE; page += 1) {
        const branches = await transport.listRepositoryBranches({
          owner,
          page,
          perPage: BRANCH_PAGE_SIZE,
          repository,
        });
        for (const { name } of branches) if (name) names.push(name);
        if (branches.length < BRANCH_PAGE_SIZE) break;
      }

      return names;
    },
    listRepositoryContributors: (repository) => loadRepositoryContributors(transport, repository),
    listAccessibleRepositories: async () => {
      const repositories = await transport.listAccessibleRepositories({ perPage: 100 });

      // A repository the caller cannot address — missing either half of
      // `owner/name` — is dropped rather than rendered as a row that cannot be
      // turned into a checkout URL.
      return repositories.flatMap(({ defaultBranch, isPrivate, name, owner: login }) =>
        name && login
          ? [
              {
                defaultBranch: defaultBranch ?? undefined,
                isPrivate: isPrivate === true,
                name,
                owner: login,
              },
            ]
          : [],
      );
    },
    listUserOrganizations: () => loadOrganizations(transport),
  };
}
